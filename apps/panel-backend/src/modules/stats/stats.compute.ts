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
  let nodeUpload = 0n;
  let nodeDownload = 0n;

  for (const u of input.users) {
    const inB = BigInt(u.bytesIn || 0);
    const outB = BigInt(u.bytesOut || 0);
    // Node-level totals are raw, unscaled bytes across the wire.
    nodeUpload += inB;
    nodeDownload += outB;
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

  // Single-counter fallback (mtproto-style): no per-user bytes at all, so roll
  // the node's cumulative totals into a per-poll delta against the snapshot.
  // first-sight (no prev) records the full cumulative as a delta - preserved
  // from the original; this is node-level dashboard history, not per-user
  // quota, so a restart spike here doesn't burn anyone's traffic.
  let newSnapshot: { in: bigint; out: bigint } | null = null;
  if (nodeDownload === 0n && nodeUpload === 0n) {
    const cumIn = BigInt(input.totalBytesIn || 0);
    const cumOut = BigInt(input.totalBytesOut || 0);
    if (cumIn > 0n || cumOut > 0n) {
      const prev = input.prevSnapshot ?? { in: 0n, out: 0n };
      // Counter dropped below the snapshot => interface restarted (kernel
      // counters reset). Treat as zero delta and re-baseline.
      const dIn = cumIn > prev.in ? cumIn - prev.in : 0n;
      const dOut = cumOut > prev.out ? cumOut - prev.out : 0n;
      newSnapshot = { in: cumIn, out: cumOut };
      nodeUpload += dIn;
      nodeDownload += dOut;
    }
  }

  return { userTrafficRows, historyRows, nodeDownload, nodeUpload, newSnapshot };
}
