import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/event-bus.js';
import { nodeUsersQueue } from './users.queue.js';

type ResetStrategy = 'day' | 'week' | 'month';

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reset usedTrafficBytes for active users with the given strategy.
 * Returns the count of users whose traffic was reset.
 */
export async function resetTrafficForStrategy(strategy: ResetStrategy): Promise<number> {
  const users = await prisma.user.findMany({
    where: { trafficLimitStrategy: strategy, deletedAt: null },
    select: { id: true, traffic: { select: { usedTrafficBytes: true } } },
  });

  if (users.length === 0) return 0;

  await prisma.userTraffic.updateMany({
    where: { userId: { in: users.map((u) => u.id) } },
    data: { usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
  });

  for (const u of users) {
    eventBus.emit('user.traffic-reset', {
      userId: u.id,
      previousUsedBytes: u.traffic?.usedTrafficBytes ?? 0n,
    });
  }
  return users.length;
}

/**
 * Reset traffic for rolling-30d users whose lastTrafficResetAt is >30d ago (or never).
 * Cross-table + null logic → raw SQL.
 */
export async function resetTrafficRolling(): Promise<number> {
  const cutoff = new Date(Date.now() - ROLLING_WINDOW_MS);

  const rows = await prisma.$queryRaw<
    { id: string; previous_used: bigint | null }[]
  >`
    SELECT u.id::text AS id, ut.used_traffic_bytes AS previous_used
    FROM users u
    LEFT JOIN user_traffic ut ON u.id = ut.user_id
    WHERE u.traffic_limit_strategy = 'rolling'
      AND u.deleted_at IS NULL
      AND (ut.last_traffic_reset_at IS NULL OR ut.last_traffic_reset_at < ${cutoff})
  `;

  if (rows.length === 0) return 0;

  await prisma.userTraffic.updateMany({
    where: { userId: { in: rows.map((r) => r.id) } },
    data: { usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
  });

  for (const r of rows) {
    eventBus.emit('user.traffic-reset', {
      userId: r.id,
      previousUsedBytes: r.previous_used ?? 0n,
    });
  }
  return rows.length;
}

/**
 * Find active users whose expire_at has passed and flip them to 'expired'.
 * Emits user.status-changed → handler chain enqueues removeUser job.
 */
export async function findExpiredUsers(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { expireAt: { lt: new Date() }, status: 'active', deletedAt: null },
    select: { id: true },
  });

  if (users.length === 0) return 0;

  const ids = users.map((u) => u.id);

  // Enqueue removeUser jobs BEFORE flipping the DB status. eventBus.emit
  // is fire-and-forget, so the original "updateMany then emit" order lost
  // the sync entirely if the process died between the two — user stayed
  // 'expired' in DB (so the next cron filter on status='active' skipped
  // them) but kept living on every node forever. With this order: a crash
  // mid-loop leaves jobs enqueued in Redis; survivors stay 'active' and
  // get re-detected next tick (removeUser is idempotent on the node side).
  //
  // CONTRACT: the removeUser worker (users.queue.ts syncRemoveUser) does
  // NOT fetch the user row and does NOT gate on status. It just sends a
  // userId to every node. So enqueueing while status is still 'active' is
  // safe — there is no "active-gate" downstream to silently skip. If that
  // ever changes, this ordering must change back to update-then-enqueue.
  // Wave-14 #12: jobId dedupes parallel cron firings against the same
  // userId. Pure `removeUser-${id}` is safe here: status flips active →
  // expired exactly once per user (a re-activation that flips back through
  // 'active' would re-enter this branch on the NEXT cron tick and the
  // completed removeUser-${id} job will have been evicted from BullMQ's
  // ring within the 1h removeOnComplete window).
  for (const id of ids) {
    await nodeUsersQueue.add('removeUser', { userId: id }, { jobId: `removeUser-${id}` });
  }
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { status: 'expired' },
  });

  // Event handlers still fire (Telegram alerts, audit log) but they no
  // longer carry the sync invariant — that's covered by the direct
  // enqueue above.
  for (const id of ids) {
    eventBus.emit('user.status-changed', { userId: id, from: 'active', to: 'expired' });
  }
  return ids.length;
}

/**
 * Find active users whose used traffic >= traffic_limit_bytes; flip to 'limited'.
 * Cross-column comparison → raw SQL.
 */
export async function findExceededTrafficUsers(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id::text AS id
    FROM users u
    JOIN user_traffic ut ON u.id = ut.user_id
    WHERE u.status = 'active'
      AND u.deleted_at IS NULL
      AND u.traffic_limit_bytes IS NOT NULL
      AND ut.used_traffic_bytes >= u.traffic_limit_bytes
  `;

  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);

  // Same crash-safety argument as findExpiredUsers — enqueue before flip.
  // Same jobId dedup rationale as findExpiredUsers (wave-14 #12).
  for (const id of ids) {
    await nodeUsersQueue.add('removeUser', { userId: id }, { jobId: `removeUser-${id}` });
  }
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { status: 'limited' },
  });

  for (const id of ids) {
    eventBus.emit('user.status-changed', { userId: id, from: 'active', to: 'limited' });
  }
  return ids.length;
}

/**
 * Reconcile orphan node-state: find users who SHOULD NOT live on any node
 * (status in expired/limited/disabled, or soft-deleted) that were flipped
 * RECENTLY but long enough ago that the primary removeUser job has had
 * a chance to retry-exhaust, and re-enqueue removeUser for each.
 *
 * Window tuning is intentional:
 *   - `gte: now - 24h` (not 30d): a tight window means a fleet of 1000
 *     limited users produces ~1000 idempotent re-queues over 24h, not
 *     ~4M over 30d. Older orphans are assumed already-removed; if not,
 *     the next status-flip / admin action bumps updatedAt back into the
 *     window.
 *   - `lte: now - 15min`: skip users flipped in the last 15 minutes —
 *     their primary removeUser job (enqueued by findExpired /
 *     findExceededTrafficUsers BEFORE the status update) is still
 *     within its retry budget (3 attempts × exponential backoff = ~7s
 *     in practice, but the worker may be backlogged).
 *
 * removeUser is idempotent on the node side, so over-enqueuing is
 * harmless beyond load. With the windowing above, expected steady-state
 * is ~N/144 jobs/tick where N = orphans flipped in last 24h.
 */
export async function reconcileOrphanNodeUsers(): Promise<number> {
  const now = Date.now();
  const lowerBound = new Date(now - 24 * 60 * 60 * 1000);     // last 24h
  const upperBound = new Date(now - 15 * 60 * 1000);          // skip last 15min
  const orphans = await prisma.user.findMany({
    where: {
      updatedAt: { gte: lowerBound, lte: upperBound },
      OR: [
        { status: { in: ['expired', 'limited', 'disabled'] } },
        { deletedAt: { not: null } },
      ],
    },
    select: { id: true },
  });

  if (orphans.length === 0) return 0;

  // Wave-14 #12: cron fires every ~10min so a stable orphan would be
  // enqueued ~144 times/day per userId, each triggering a full mTLS fanout
  // across every node. Daily-bucket jobId dedupes within a 24h window
  // (matches the reconcile window above) but lets re-enqueue happen next
  // day if the original failed and aged out. Picked daily over hourly to
  // bound recovery latency at <=24h while keeping the cron self-healing.
  const dayBucket = Math.floor(now / 86_400_000);
  for (const u of orphans) {
    await nodeUsersQueue.add(
      'removeUser',
      { userId: u.id },
      { jobId: `removeUser-${u.id}-d${dayBucket}` },
    );
  }
  return orphans.length;
}
