/**
 * Pure traffic-delta math for the node-stats cron (B3). Extracted from
 * stats.cron so the bug-prone part - scaling, zero-delta skips, the
 * presence-only (mtproto) signal, and the single-counter cumulative fallback -
 * can be unit-tested without a database. The cron feeds the returned arrays
 * straight into one bulk `unnest`-based upsert per table instead of N
 * per-user upserts.
 *
 * Billing vs node-history asymmetry (preserved from the original): per-user
 * rows are scaled by the node's consumption multiplier (premium regions count
 * more against quotas), while node-level totals are the raw bytes that crossed
 * the wire.
 */

export interface StatsUserEntry {
  userId: string;
  bytesIn?: number;
  bytesOut?: number;
}

export interface NodeStatsInput {
  users: StatsUserEntry[];
  /** node.consumptionMultiplier; <=0/NaN falls back to 1. */
  multiplier: number;
  /** True only for adapters that report presence but no per-user bytes (mtproto). */
  isPresenceOnlyProtocol: boolean;
  /** Cumulative node counters, used only when there are no per-user bytes. */
  totalBytesIn?: number;
  totalBytesOut?: number;
  /** Last seen cumulative snapshot for this node (single-counter fallback). */
  prevSnapshot?: { in: bigint; out: bigint };
  /**
   * Sanity ceiling for a single user's per-poll bytesIn/bytesOut. A delta above
   * this is physically impossible for the poll interval and means the agent
   * re-billed its lifetime cumulative (a node-agent predating the AWG per-poll-
   * delta fix, or any future counter bug). Such an entry is discarded entirely
   * (no billing, no history, no node total) and surfaced in `clamped` so the
   * caller can warn. undefined = no ceiling (back-compat; existing tests).
   */
  maxUserDeltaBytes?: number;
  /**
   * When true, node-level history (node_usage_history) is derived from the
   * cumulative `totalBytesIn/Out` delta against `prevSnapshot`, NOT from the
   * per-user byte sum. Set for cores whose node total includes traffic with no
   * tracked user, e.g. an xray cascade link-in inbound that relays for the next
   * hop. Per-user billing still comes from `users`. First sight (no prevSnapshot,
   * e.g. after a backend restart clears the in-memory snapshot) baselines to a
   * zero delta instead of billing the whole since-start cumulative as one spike.
   */
  nodeTotalIsCumulative?: boolean;
}

/** One per-user `user_traffic` increment (used+lifetime). 0 = presence touch. */
export interface UserTrafficRow {
  userId: string;
  scaled: bigint;
}

/** One per-user `node_user_usage_history` daily-bucket increment. */
export interface UserHistoryRow {
  userId: string;
  bytesIn: bigint;
  bytesOut: bigint;
}

export interface NodeStatsWrites {
  /** Real-byte users (scaled>0) plus presence-only users (scaled=0). */
  userTrafficRows: UserTrafficRow[];
  /** Real-byte users only - nothing to bucket for a zero-byte presence touch. */
  historyRows: UserHistoryRow[];
  /** Raw (unscaled) bytes for node_usage_history. */
  nodeDownload: bigint;
  nodeUpload: bigint;
  /**
   * New cumulative snapshot when the single-counter fallback consumed the
   * node totals; null otherwise. The caller persists it AFTER a successful
   * commit so a failed write doesn't advance the baseline and silently drop
   * those bytes (slightly tighter than the original, which advanced it
   * pre-commit).
   */
  newSnapshot: { in: bigint; out: bigint } | null;
  /**
   * Entries whose per-poll delta exceeded `maxUserDeltaBytes` and were dropped.
   * Empty when no ceiling was set or nothing tripped it. The caller logs these:
   * a non-empty list almost always means a misbehaving / outdated node-agent.
   */
  clamped: { userId: string; bytesIn: number; bytesOut: number }[];
}

/** Cumulative per-(node,user) byte snapshot the poller persists between ticks. */
export interface UserSnapshot {
  cumIn: bigint;
  cumOut: bigint;
}

export interface UserDeltaResult {
  /** Per-poll deltas, ready to feed into computeNodeStatsWrites as `users`. */
  deltas: StatsUserEntry[];
  /** Cumulative values seen this tick, to persist as the new snapshot per user. */
  snapshots: { userId: string; cumIn: bigint; cumOut: bigint }[];
}

/**
 * #5 - turn cumulative-since-core-start per-user counters (xray non-destructive
 * read) into per-poll deltas against the stored snapshot. Because the read is
 * non-destructive, a lost response or a failed commit never drops bytes: the
 * snapshot is not advanced on failure, so the next poll's delta re-includes the
 * missed bytes.
 *
 * Per-user rules — mirror the node-level cumulative path (computeNodeStatsWrites)
 * so a per-user counter can never bill more than the node itself recorded:
 *   - first sight (no prior snapshot): delta 0, just baseline. We must NOT bill
 *     the whole accumulated-since-core-start counter to the user (it could be a
 *     long-running xray's lifetime traffic, or this snapshot table being new).
 *   - counter dropped below the snapshot (current < prev): the core restarted
 *     and reset the counter — the pre-reset final delta is unknowable, so
 *     re-baseline with a delta of 0 (NOT the whole new since-restart cumulative).
 *     Billing `current` here was a real over-count: it spiked a user by the full
 *     post-restart total in one poll (e.g. a 43 GB u1/Frankfurt-2 line while the
 *     node itself only recorded 661 MB, because the node-level path already
 *     clamps resets to 0 and the per-user path did not).
 *   - otherwise: delta = current - previous.
 */
export function computeUserDeltas(
  reported: StatsUserEntry[],
  prev: Map<string, UserSnapshot>,
): UserDeltaResult {
  // A node can report the same userId more than once per poll: a user reachable
  // on multiple inbounds/protocols on one node (vless + shadowsocks both ride
  // xray; the agent merges every adapter's stats). Sum their cumulative counters
  // into ONE entry per userId FIRST. Without this, the snapshot upsert's unnest
  // gets a duplicate (node_id, user_id) and Postgres aborts the whole statement
  // with 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"), rolling back the node's entire stats transaction (so it records
  // nothing). Mirrors the userId aggregation computeNodeStatsWrites already does.
  const byUser = new Map<string, { cumIn: bigint; cumOut: bigint }>();
  for (const u of reported) {
    const cur = byUser.get(u.userId) ?? { cumIn: 0n, cumOut: 0n };
    cur.cumIn += BigInt(u.bytesIn || 0);
    cur.cumOut += BigInt(u.bytesOut || 0);
    byUser.set(u.userId, cur);
  }

  const deltas: StatsUserEntry[] = [];
  const snapshots: { userId: string; cumIn: bigint; cumOut: bigint }[] = [];
  for (const [userId, { cumIn, cumOut }] of byUser) {
    const p = prev.get(userId);
    // No prior snapshot (first sight) OR counter below snapshot (core restart)
    // -> baseline with a 0 delta. Only a monotonic increase bills real bytes.
    // Matches the node-level cumulative path so per-user can't exceed the node.
    const dIn = p && cumIn >= p.cumIn ? cumIn - p.cumIn : 0n;
    const dOut = p && cumOut >= p.cumOut ? cumOut - p.cumOut : 0n;
    deltas.push({ userId, bytesIn: Number(dIn), bytesOut: Number(dOut) });
    snapshots.push({ userId, cumIn, cumOut });
  }
  return { deltas, snapshots };
}

export function computeNodeStatsWrites(input: NodeStatsInput): NodeStatsWrites {
  const multiplier = Number(input.multiplier ?? 1) || 1;
  const scale = (v: bigint): bigint =>
    multiplier === 1 ? v : BigInt(Math.round(Number(v) * multiplier));

  // Aggregate by userId BEFORE producing rows. A node can report the same user
  // more than once per poll (a user with multiple inbounds on one node, e.g.
  // vless + trojan), and the bulk unnest upsert must not let ON CONFLICT touch
  // the same target row twice in one statement (Postgres error 21000). Summing
  // each entry's scaled bytes here matches the old per-user loop exactly (it ran
  // one increment per entry) and keeps userIds unique in the unnest array.
  const usedByUser = new Map<string, bigint>();
  const histByUser = new Map<string, { in: bigint; out: bigint }>();
  const presenceOnly = new Set<string>();
  const clamped: { userId: string; bytesIn: number; bytesOut: number }[] = [];
  const ceiling =
    input.maxUserDeltaBytes !== undefined ? BigInt(input.maxUserDeltaBytes) : null;
  let nodeUpload = 0n;
  let nodeDownload = 0n;

  for (const u of input.users) {
    const inB = BigInt(u.bytesIn || 0);
    const outB = BigInt(u.bytesOut || 0);
    // Sanity guard: one poll's delta is at most the traffic since the previous
    // poll. A value above the ceiling can't be real for one user on one link and
    // means the agent re-billed its lifetime cumulative (a node-agent built
    // before the AWG per-poll-delta fix re-sent the whole counter every poll, or
    // any future counter bug). Discard the entry entirely - billing nothing is
    // far safer than writing phantom TiB into a user's quota and the node's
    // history. Surface it so the caller warns; the fix is to redeploy that node.
    if (ceiling !== null && (inB > ceiling || outB > ceiling)) {
      clamped.push({ userId: u.userId, bytesIn: Number(inB), bytesOut: Number(outB) });
      continue;
    }
    // Node-level totals are raw, unscaled bytes across the wire. Skipped when
    // the node total comes from the cumulative inbound counter instead (that
    // path adds the node delta below), so per-user bytes aren't double-counted.
    if (!input.nodeTotalIsCumulative) {
      nodeUpload += inB;
      nodeDownload += outB;
    }
    const delta = inB + outB;
    if (delta === 0n) {
      // Presence-only adapters (mtproto): the user appearing in the response is
      // the only "online" signal we get. Record a zero-increment touch (so the
      // upsert refreshes online_at/last_connected_node_id) without billing; skip
      // the daily history. Non-presence protocols drop the zero-delta user.
      if (input.isPresenceOnlyProtocol) presenceOnly.add(u.userId);
      continue;
    }
    usedByUser.set(u.userId, (usedByUser.get(u.userId) ?? 0n) + scale(delta));
    const h = histByUser.get(u.userId) ?? { in: 0n, out: 0n };
    h.in += scale(inB);
    h.out += scale(outB);
    histByUser.set(u.userId, h);
  }

  // A userId that moved real bytes on one inbound and zero on another is billed
  // (it's in usedByUser); drop it from the presence-only touch set to avoid a
  // duplicate user_traffic row in the unnest.
  for (const id of usedByUser.keys()) presenceOnly.delete(id);

  const userTrafficRows: UserTrafficRow[] = [];
  for (const [userId, scaled] of usedByUser) {
    userTrafficRows.push({ userId, scaled });
  }
  for (const userId of presenceOnly) {
    userTrafficRows.push({ userId, scaled: 0n });
  }
  const historyRows: UserHistoryRow[] = [];
  for (const [userId, h] of histByUser) {
    historyRows.push({ userId, bytesIn: h.in, bytesOut: h.out });
  }

  // Deadlock avoidance (Postgres 40P01): two concurrent per-node transactions
  // bulk-upserting the same user_traffic rows can deadlock if they take the
  // shared row locks in opposite orders (the node reports userIds in arbitrary
  // order). Sort both row arrays by userId ascending so every transaction
  // acquires those locks in the same global order. The agent already drained
  // xray with -reset before we get here, so a deadlocked tick's delta would be
  // lost - ordering the unnest is what keeps it. Order-only; values unchanged.
  userTrafficRows.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  historyRows.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  // Node-total path, two callers:
  //   - nodeTotalIsCumulative (xray): the node total is a cumulative inbound
  //     counter; always run, since the per-user sum was skipped above.
  //   - single-counter fallback (mtproto): no per-user bytes at all, so roll the
  //     node's cumulative totals into a per-poll delta.
  // Either way: delta against the stored snapshot, and a counter that dropped
  // below the snapshot means the core restarted, so re-baseline with a 0 delta.
  let newSnapshot: { in: bigint; out: bigint } | null = null;
  if (input.nodeTotalIsCumulative || (nodeDownload === 0n && nodeUpload === 0n)) {
    const cumIn = BigInt(input.totalBytesIn || 0);
    const cumOut = BigInt(input.totalBytesOut || 0);
    if (cumIn > 0n || cumOut > 0n) {
      const hasPrev = input.prevSnapshot !== undefined;
      const prev = input.prevSnapshot ?? { in: 0n, out: 0n };
      // First sight with a cumulative inbound counter: baseline only, don't bill
      // the whole since-start total as one spike (the in-memory snapshot clears
      // on every backend restart). The legacy single-counter fallback keeps its
      // original first-sight-records-full behavior (mtproto, dashboard-only).
      const baselineOnly = !hasPrev && input.nodeTotalIsCumulative === true;
      const dIn = baselineOnly ? 0n : cumIn > prev.in ? cumIn - prev.in : 0n;
      const dOut = baselineOnly ? 0n : cumOut > prev.out ? cumOut - prev.out : 0n;
      newSnapshot = { in: cumIn, out: cumOut };
      nodeUpload += dIn;
      nodeDownload += dOut;
    }
  }

  return { userTrafficRows, historyRows, nodeDownload, nodeUpload, newSnapshot, clamped };
}
