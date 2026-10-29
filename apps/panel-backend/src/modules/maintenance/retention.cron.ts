import { ADMIN_AUDIT_RETENTION_DAYS, DELETED_USER_RETENTION_DAYS, HWID_DEVICE_RETENTION_DAYS } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { purgeExpiredBootstrapTokens } from '../nodes/bootstrap.service.js';
import { sourceIdSha256 } from '../users/erased-sources.js';

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
  // Exported below: the host-freshness screen reads "this subscriber has not
  // polled since the change" out of the same table, so it has to be able to say
  // how far back that evidence goes. Two copies of the number would drift, and
  // the screen would quietly start claiming more than the data supports.
  nodeUserUsage: 180,
  nodeUsage: 800,
  // subscription_events is append-only (one row per admin action / status flip).
  // Growth is slow but unbounded (review M7). 180d matches nodeUserUsage audit
  // headroom while keeping the table from filling a 2 GB VPS disk over years.
  subscriptionEvents: 180,
  // A-268, A-269 (owner, 26.10): a deleted user is erased, an unseen device
  // forgotten. The numbers live in @iceslab/shared (retention.ts): the delete
  // dialog and the device list say them too, from the same constant.
  deletedUsers: DELETED_USER_RETENTION_DAYS,
  hwidDevices: HWID_DEVICE_RETENTION_DAYS,
  // The admin audit log keeps a year; the screen names the window from the
  // same constant.
  adminAudit: ADMIN_AUDIT_RETENTION_DAYS,
} as const;

export { DELETED_USER_RETENTION_DAYS, HWID_DEVICE_RETENTION_DAYS };

/** Users erased per transaction, so one huge backlog is never one huge lock. */
const USER_PURGE_BATCH = 500;

/**
 * A-268: erase users deleted more than DELETED_USER_RETENTION_DAYS ago.
 *
 * Every table that holds a user's rows, read from prisma/models 26.10:
 *   user_traffic, amneziawg_peers, hwid_user_devices (users.prisma:95, :119,
 *   :150), group_members (squads.prisma:100), subscription_events,
 *   subscription_request_history (subscription.prisma:20, :84),
 *   node_user_usage_history (nodes.prisma:324): FK ON DELETE CASCADE, they go
 *   with the user row.
 *   node_user_traffic_snapshot (nodes.prisma:357) has NO foreign key on purpose
 *   (the hot stats write), so its rows are deleted here, in the same
 *   transaction, before the user.
 * Nothing restores a deleted user (no route sets deleted_at back), so within
 * the window the row simply stays as it was.
 */
export async function purgeDeletedUsers(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - RETENTION_DAYS.deletedUsers * DAY_MS);
  let total = 0;
  for (;;) {
    const rows = await prisma.user.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, sourceId: true },
      take: USER_PURGE_BATCH,
    });
    const ids = rows.map((u) => u.id);
    if (ids.length === 0) return total;
    // The tombstone (ARCH 26.10): an imported user leaves the hash of their
    // source id, so the next import run of that source is refused with
    // SOURCE_ID_ERASED instead of bringing them back with their old link.
    const tombstones = rows
      .filter((u): u is { id: string; sourceId: string } => u.sourceId !== null)
      .map((u) => ({ sourceIdSha256: sourceIdSha256(u.sourceId) }));
    const [, , users] = await prisma.$transaction([
      prisma.erasedUserSource.createMany({ data: tombstones, skipDuplicates: true }),
      prisma.nodeUserTrafficSnapshot.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids }, deletedAt: { lt: cutoff } } }),
    ]);
    total += users.count;
    if (ids.length < USER_PURGE_BATCH) return total;
  }
}

/** How long a `/sub` poll stays on record. See the note above. */
export const SUBSCRIPTION_REQUEST_RETENTION_DAYS = RETENTION_DAYS.subscriptionRequests;

export interface PruneResult {
  subscriptionRequests: number;
  nodeUserUsage: number;
  nodeUsage: number;
  subscriptionEvents: number;
  bootstrapTokens: number;
  deletedUsers: number;
  hwidDevices: number;
  adminAudit: number;
}

/**
 * Delete history rows older than their retention window. Idempotent and safe
 * to run repeatedly: a second run the same day deletes nothing. Each deleteMany
 * is independent, so one slow table never blocks the others.
 *
 * Also purges expired/consumed node_bootstrap_tokens here - they're short-TTL
 * single-use rows that nothing else cleans up, so without this daily sweep the
 * table grows unbounded.
 */
export async function pruneHistory(): Promise<PruneResult> {
  const now = Date.now();
  const [subscriptionRequests, nodeUserUsage, nodeUsage, subscriptionEvents, bootstrapTokens, deletedUsers, hwidDevices, adminAudit] =
    await Promise.all([
      prisma.subscriptionRequestHistory.deleteMany({
        where: { requestedAt: { lt: new Date(now - RETENTION_DAYS.subscriptionRequests * DAY_MS) } },
      }),
      prisma.nodeUserUsageHistory.deleteMany({
        where: { date: { lt: new Date(now - RETENTION_DAYS.nodeUserUsage * DAY_MS) } },
      }),
      prisma.nodeUsageHistory.deleteMany({
        where: { hour: { lt: new Date(now - RETENTION_DAYS.nodeUsage * DAY_MS) } },
      }),
      prisma.subscriptionEvent.deleteMany({
        where: { createdAt: { lt: new Date(now - RETENTION_DAYS.subscriptionEvents * DAY_MS) } },
      }),
      purgeExpiredBootstrapTokens(),
      purgeDeletedUsers(now),
      // A-269: the device limit counts these rows, so one gone is a slot freed.
      prisma.hwidUserDevice.deleteMany({
        where: { lastSeenAt: { lt: new Date(now - RETENTION_DAYS.hwidDevices * DAY_MS) } },
      }),
      prisma.adminAuditEvent.deleteMany({
        where: { at: { lt: new Date(now - RETENTION_DAYS.adminAudit * DAY_MS) } },
      }),
    ]);
  return {
    subscriptionRequests: subscriptionRequests.count,
    nodeUserUsage: nodeUserUsage.count,
    nodeUsage: nodeUsage.count,
    subscriptionEvents: subscriptionEvents.count,
    bootstrapTokens,
    deletedUsers,
    hwidDevices: hwidDevices.count,
    adminAudit: adminAudit.count,
  };
}
