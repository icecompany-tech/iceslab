import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/event-bus.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';
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
  // Bug #8 fix (reverts wave-14 #12 jobId here): NO dedup jobId on the
  // expiry path. A user transitions active -> expired exactly once (after the
  // flip they're no longer 'active', so later ticks don't re-select them), so
  // there is no repeated-enqueue load to dedup against. The `removeUser-${id}`
  // jobId only created a bug: if the user was re-activated and re-expired
  // within the 1h removeOnComplete window, the completed job still "owned" the
  // jobId and the new enqueue was a silent no-op, leaving them connected.
  // removeUser is idempotent on the node side, so an occasional duplicate
  // (e.g. reconcile also enqueues) is harmless. (reconcile keeps its own
  // day-bucket jobId because IT re-selects orphans every tick.)
  // B11: one addBulk instead of N awaited add()s — a 1000-user expiry batch
  // was 1000 sequential Redis round-trips; addBulk pipelines them.
  await nodeUsersQueue.addBulk(
    ids.map((id) => ({ name: 'removeUser', data: { userId: id } })),
  );
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
  // Bug #8: no dedup jobId here either (same one-time-transition reasoning;
  // see findExpiredUsers). A limited user re-activated then re-limited within
  // the hour must still get removed. B11: addBulk over per-id awaited add.
  await nodeUsersQueue.addBulk(
    ids.map((id) => ({ name: 'removeUser', data: { userId: id } })),
  );
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
  // B11: addBulk keeps the per-orphan day-bucket jobId (dedup) while
  // collapsing N round-trips into one pipelined call.
  await nodeUsersQueue.addBulk(
    orphans.map((u) => ({
      name: 'removeUser',
      data: { userId: u.id },
      opts: { jobId: `removeUser-${u.id}-d${dayBucket}` },
    })),
  );
  return orphans.length;
}

// K3-tail - proactive near-expiry / near-cap alerts, as a once-daily digest
// (not per-user spam, so no dedup state is needed). Sent to the operator's
// Telegram (no-op when Telegram isn't configured).
const NEAR_EXPIRY_DAYS = 3;
const NEAR_CAP_PERCENT = 90;

/** Build the digest message (pure + testable). Null = nothing to report. */
export function formatNearLimitsDigest(
  expiring: { username: string; expireAt: Date | null }[],
  nearCap: { username: string; pct: number }[],
): string | null {
  if (expiring.length === 0 && nearCap.length === 0) return null;
  const lines: string[] = ['*Iceslab daily digest*'];
  if (expiring.length > 0) {
    lines.push(`*Expiring soon (<= ${NEAR_EXPIRY_DAYS}d):*`);
    for (const u of expiring) {
      const when = u.expireAt ? u.expireAt.toISOString().slice(0, 10) : '?';
      lines.push(`- ${escapeMarkdown(u.username)}: ${when}`);
    }
  }
  if (nearCap.length > 0) {
    lines.push(`*Near traffic cap (>= ${NEAR_CAP_PERCENT}%):*`);
    for (const u of nearCap) {
      lines.push(`- ${escapeMarkdown(u.username)}: ${u.pct}%`);
    }
  }
  return lines.join('\n');
}

/**
 * Find active users near expiry (<= NEAR_EXPIRY_DAYS away) or near their
 * traffic cap (>= NEAR_CAP_PERCENT% but not yet over) and send the operator a
 * single Telegram digest. Returns the number of users in the digest.
 */
export async function alertNearLimits(): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 86_400_000);

  const expiring = await prisma.user.findMany({
    where: { status: 'active', deletedAt: null, expireAt: { gte: now, lte: soon } },
    select: { username: true, expireAt: true },
    orderBy: { expireAt: 'asc' },
    take: 50,
  });

  // used >= 90% of limit but still under it (at/over -> findExceededTrafficUsers).
  const nearCap = await prisma.$queryRaw<{ username: string; pct: number }[]>`
    SELECT u.username AS username,
           floor(ut.used_traffic_bytes::numeric / u.traffic_limit_bytes::numeric * 100)::int AS pct
    FROM users u
    JOIN user_traffic ut ON u.id = ut.user_id
    WHERE u.status = 'active' AND u.deleted_at IS NULL
      AND u.traffic_limit_bytes IS NOT NULL AND u.traffic_limit_bytes > 0
      AND ut.used_traffic_bytes >= u.traffic_limit_bytes * ${NEAR_CAP_PERCENT} / 100
      AND ut.used_traffic_bytes < u.traffic_limit_bytes
    ORDER BY pct DESC
    LIMIT 50
  `;

  const msg = formatNearLimitsDigest(expiring, nearCap);
  if (!msg) return 0;
  notifyTelegramAsync(msg);
  return expiring.length + nearCap.length;
}
