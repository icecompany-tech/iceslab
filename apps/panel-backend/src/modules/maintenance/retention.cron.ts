import { prisma } from '../../prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// B2 - retention windows for the append-only history tables. Without a prune
// these grow unbounded and eventually fill the disk on a 2 GB VPS.
//
// - subscription_request_history is the high-churn offender (one row per /sub
//   poll; clients refresh every few minutes). The SRH inspector (K1-b) only
//   looks back 90d, so anything older is dead weight.
// - node_user_usage_history powers "top users today" (today only); 180d is
//   generous audit headroom.
// - node_usage_history feeds the dashboard's year-over-year traffic deltas
//   (startOfLastYear can reach ~24 months back at year-end), so it keeps a
//   wide 800-day window. Its cardinality is low (one row per node-hour), so
//   that's cheap to retain.
const RETENTION_DAYS = {
  subscriptionRequests: 90,
  nodeUserUsage: 180,
  nodeUsage: 800,
} as const;

export interface PruneResult {
  subscriptionRequests: number;
  nodeUserUsage: number;
  nodeUsage: number;
}

/**
 * Delete history rows older than their retention window. Idempotent and safe
 * to run repeatedly: a second run the same day deletes nothing. Each deleteMany
 * is independent, so one slow table never blocks the others.
 */
export async function pruneHistory(): Promise<PruneResult> {
  const now = Date.now();
  const [subscriptionRequests, nodeUserUsage, nodeUsage] = await Promise.all([
    prisma.subscriptionRequestHistory.deleteMany({
      where: { requestedAt: { lt: new Date(now - RETENTION_DAYS.subscriptionRequests * DAY_MS) } },
    }),
    prisma.nodeUserUsageHistory.deleteMany({
      where: { date: { lt: new Date(now - RETENTION_DAYS.nodeUserUsage * DAY_MS) } },
    }),
    prisma.nodeUsageHistory.deleteMany({
      where: { hour: { lt: new Date(now - RETENTION_DAYS.nodeUsage * DAY_MS) } },
    }),
  ]);
  return {
    subscriptionRequests: subscriptionRequests.count,
    nodeUserUsage: nodeUserUsage.count,
    nodeUsage: nodeUsage.count,
  };
}
