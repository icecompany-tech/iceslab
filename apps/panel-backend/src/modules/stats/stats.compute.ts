/**
 * Pure traffic-delta math for the node-stats cron (B3). Extracted from
 * stats.cron so the bug-prone part - scaling, zero-delta skips and the
 * single-counter cumulative fallback -
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
  /**
   * Per-user counter mode from the agent (wire field `cumulative`). True =
   * cumulative-since-core-start (xray/singbox non-destructive read), false/
   * undefined = already a per-poll delta. The delta math here ignores it; the
   * cron reads it to snapshot-delta only the cumulative users on a mixed node.
   */
  cumulative?: boolean;
  /**
   * The protocol of the inbound this entry came through (wire field
   * `protocol`, the reporting adapter); absent on older agents. With `engine`
   * it keys the snapshot below.
   */
  protocol?: string;
  /**
   * A-163: the engine of the adapter that counted this entry (wire field
   * `engine`). With `protocol` it names the ADAPTER, the key of the user's
   * cumulative snapshot. Absent on older agents: their entries keep one
   * summed snapshot per (node, user), as before.
   */
  engine?: string;
}

/** The adapter an entry's snapshot is keyed by: (protocol, engine), or
 *  ('', '') for an agent that does not name its engine (one summed row). */
export function snapshotAdapterOf(u: { protocol?: string; engine?: string }): { protocol: string; engine: string } {
  return u.engine ? { protocol: u.protocol ?? '', engine: u.engine } : { protocol: '', engine: '' };
}

export function snapshotKey(userId: string, a: { protocol: string; engine: string }): string {
  return `${userId}|${a.protocol}|${a.engine}`;
}

/*
 * A-121: no protocol's listing is an online signal any more. mtproto (mtg) has
 * one secret, so its traffic cannot be attributed to a user, and its adapter
 * lists not who connected but every user the panel sent it, that is every
 * active user, served or not. Taking the listing as "online" marked the whole
 * roster online every 30 seconds, moved everyone's last node to that one, gave
 * a first-connected date to people who never connected, and upserted every
 * user_traffic row per node per poll. A user is online by bytes they moved;
 * an mtproto user is not shown online at all until mtg can tell users apart.
 */

export interface NodeStatsInput {
  users: StatsUserEntry[];
  /** The node's consumption multiplier, 0 to 100 in steps of 0.1; 0 is a free
   *  node (A-143). NaN or absent falls back to 1. */
  multiplier: number;
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
  /**
   * A-152: the node's raw bytes this poll, already worked out per adapter
   * (computeNodeTotalsFromCores) from an agent that reports `cores`. When set
   * it IS the node total: neither the per-user sum nor the mixed cumulative
   * total is used, so a delta core beside a cumulative one is counted, not
   * swallowed by a snapshot of their sum.
   */
  nodeTotals?: { upload: bigint; download: bigint };
}

/** One per-user billing increment and its unscaled activity evidence. */
export interface UserTrafficRow {
  userId: string;
  scaled: bigint;
  hasActivity: boolean;
}

/** One per-user `node_user_usage_history` daily-bucket increment. */
export interface UserHistoryRow {
  userId: string;
  bytesIn: bigint;
  bytesOut: bigint;
}

export interface NodeStatsWrites {
  /** Users who moved bytes this poll. */
  userTrafficRows: UserTrafficRow[];
  /** The same users' daily buckets. */
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
  /** Cumulative values seen this tick, to persist as the new snapshot per
   *  (user, adapter). An adapter that did not answer this poll has no entry,
   *  so its snapshot stays where it was (A-163). */
  snapshots: { userId: string; protocol: string; engine: string; cumIn: bigint; cumOut: bigint }[];
}

/**
 * #5 - turn cumulative-since-core-start per-user counters (xray non-destructive
 * read) into per-poll deltas against the stored snapshot. Because the read is
 * non-destructive, a lost response or a failed commit never drops bytes: the
 * snapshot is not advanced on failure, so the next poll's delta re-includes the
 * missed bytes.
 *
 * Per-user rules (stricter than the node-level single-counter fallback, which
 * may spike on first sight because it is dashboard-only, not billing):
 *   - first sight (no prior snapshot): delta 0, just baseline. We must NOT bill
 *     the whole accumulated-since-core-start counter to the user (it could be a
 *     long-running xray's lifetime traffic, or this snapshot table being new).
 *   - counter dropped below the snapshot: a core restart (counters reset) OR a
 *     partial report (one of the user's inbounds missing this poll). Either way
 *     the residual cumulative is not a real per-poll delta, so bill 0 and
 *     re-baseline, matching the node-level cumulative path. Billing it would
 *     spike the user's quota by the whole residual (phantom tens of GB in one
 *     poll); losing one poll's post-restart bytes is the safe tradeoff.
 *   - otherwise: delta = current - previous.
 */
export function computeUserDeltas(
  reported: StatsUserEntry[],
  prev: Map<string, UserSnapshot>,
): UserDeltaResult {
  // A-163: grouped by (user, ADAPTER), each group against its own snapshot,
  // and the per-adapter deltas then add up downstream (computeNodeStatsWrites
  // sums by user). Summing every adapter of a user against ONE snapshot was
  // the bug: one adapter silent for a poll lowered the sum, the snapshot
  // re-baselined down, and its return billed the adapter's whole cumulative
  // counter at once. An adapter that did not answer has no entries here, so
  // its snapshot is simply not touched.
  //
  // Within one adapter the entries of a user are still summed first (a user on
  // two inbounds of the same xray), or the snapshot upsert's unnest would meet
  // a duplicate key and Postgres would abort the node's whole stats
  // transaction with 21000. An agent that names no engine falls into one
  // ('', '') group per user: the summed snapshot it always had.
  const groups = new Map<
    string,
    { userId: string; protocol: string; engine: string; cumIn: bigint; cumOut: bigint; protocols: Set<string | undefined> }
  >();
  for (const u of reported) {
    const a = snapshotAdapterOf(u);
    const key = snapshotKey(u.userId, a);
    const cur = groups.get(key) ?? { userId: u.userId, ...a, cumIn: 0n, cumOut: 0n, protocols: new Set() };
    cur.cumIn += BigInt(u.bytesIn || 0);
    cur.cumOut += BigInt(u.bytesOut || 0);
    cur.protocols.add(u.protocol);
    groups.set(key, cur);
  }

  const deltas: StatsUserEntry[] = [];
  const snapshots: UserDeltaResult['snapshots'] = [];
  for (const [key, g] of groups) {
    const p = prev.get(key);
    // First sight of this (user, adapter): baseline only. A counter below its
    // snapshot: that adapter restarted, re-baseline with 0 (losing one poll is
    // the safe side of a phantom spike).
    const dIn = p ? (g.cumIn >= p.cumIn ? g.cumIn - p.cumIn : 0n) : 0n;
    const dOut = p ? (g.cumOut >= p.cumOut ? g.cumOut - p.cumOut : 0n) : 0n;
    // The protocol survives the merge, so the entry is still judged by its
    // inbound downstream.
    const protocol = [...g.protocols].find((x) => x !== undefined);
    deltas.push({
      userId: g.userId,
      bytesIn: Number(dIn),
      bytesOut: Number(dOut),
      ...(protocol !== undefined ? { protocol } : {}),
    });
    snapshots.push({ userId: g.userId, protocol: g.protocol, engine: g.engine, cumIn: g.cumIn, cumOut: g.cumOut });
  }
  return { deltas, snapshots };
}

/** One adapter's node total from the agent (wire CoreTrafficTotal). */
export interface CoreTotalEntry {
  protocol: string;
  engine: string;
  bytesIn: number;
  bytesOut: number;
  cumulative: boolean;
  noData?: boolean;
}

/**
 * A-152: the node's raw bytes this poll, adapter by adapter. A cumulative
 * adapter is deltaed against its own snapshot (first sight baselines to 0, a
 * drop below the snapshot is a restart and re-baselines to 0); a delta adapter
 * counts as it comes; an adapter with noData counts nothing and keeps its
 * snapshot. The sum is the node total.
 *
 * Before, the node total was one mixed number (a cumulative xray counter plus
 * a per-poll AmneziaWG delta) compared with one snapshot: xray +1 MB beside
 * AmneziaWG 50 MB then 5 MB read as a drop, re-baselined and counted 0, where
 * 6 MB crossed the wire.
 */
export function computeNodeTotalsFromCores(
  cores: CoreTotalEntry[],
  prev: Map<string, { in: bigint; out: bigint }>,
): { upload: bigint; download: bigint; snapshots: Map<string, { in: bigint; out: bigint }> } {
  let upload = 0n;
  let download = 0n;
  const snapshots = new Map<string, { in: bigint; out: bigint }>();
  for (const c of cores) {
    if (c.noData) continue;
    const inB = BigInt(c.bytesIn || 0);
    const outB = BigInt(c.bytesOut || 0);
    if (!c.cumulative) {
      upload += inB;
      download += outB;
      continue;
    }
    const key = `${c.protocol}|${c.engine}`;
    const p = prev.get(key);
    if (p) {
      upload += inB >= p.in ? inB - p.in : 0n;
      download += outB >= p.out ? outB - p.out : 0n;
    }
    snapshots.set(key, { in: inB, out: outB });
  }
  return { upload, download, snapshots };
}

export function computeNodeStatsWrites(input: NodeStatsInput): NodeStatsWrites {
  // A-143: the multiplier in whole tenths, and the bytes scaled in integers:
  // bytes * tenths / 10, rounded half up, the one rounding of this sum. A free
  // node (0) counts 0 bytes against quotas; the node's own usage stays raw
  // below. Only NaN or an absent value means 1: `|| 1` turned 0 into 1 too,
  // and a free node was billed in full.
  const m = Number(input.multiplier);
  const tenths = BigInt(Number.isFinite(m) && m >= 0 ? Math.round(m * 10) : 10);
  const scale = (v: bigint): bigint => (tenths === 10n ? v : (v * tenths + 5n) / 10n);

  // Aggregate by userId BEFORE producing rows. A node can report the same user
  // more than once per poll (a user with multiple inbounds on one node, e.g.
  // vless + trojan), and the bulk unnest upsert must not let ON CONFLICT touch
  // the same target row twice in one statement (Postgres error 21000). Summing
  // each entry's scaled bytes here matches the old per-user loop exactly (it ran
  // one increment per entry) and keeps userIds unique in the unnest array.
  const usedByUser = new Map<string, UserTrafficRow>();
  const histByUser = new Map<string, { in: bigint; out: bigint }>();
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
    if (!input.nodeTotalIsCumulative && !input.nodeTotals) {
      nodeUpload += inB;
      nodeDownload += outB;
    }
    const delta = inB + outB;
    // A user who moved nothing is not written: no row, no online touch, on
    // every protocol (A-121, see above).
    if (delta === 0n) continue;
    const traffic = usedByUser.get(u.userId) ?? { userId: u.userId, scaled: 0n, hasActivity: false };
    traffic.scaled += scale(delta);
    traffic.hasActivity ||= inB >= 0n && outB >= 0n && delta > 0n;
    usedByUser.set(u.userId, traffic);
    const h = histByUser.get(u.userId) ?? { in: 0n, out: 0n };
    h.in += scale(inB);
    h.out += scale(outB);
    histByUser.set(u.userId, h);
  }

  const userTrafficRows = [...usedByUser.values()];
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
  if (input.nodeTotals) {
    // A-152: worked out per adapter by the caller.
    nodeUpload = input.nodeTotals.upload;
    nodeDownload = input.nodeTotals.download;
  } else if (input.nodeTotalIsCumulative || (nodeDownload === 0n && nodeUpload === 0n)) {
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
