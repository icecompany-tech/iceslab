import { ADMIN_AUDIT_LOGIN_REFUSAL_CAP } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/infra/redis.js';
import { getLogger } from '../../lib/infra/logger.js';

/**
 * A-288: refused sign-ins are written row by row up to a cap per hour, per
 * network and in all (ADMIN_AUDIT_LOGIN_REFUSAL_CAP); past it, one summary
 * row per hour and key ("<network>" or "all") counts the rest. Only refusals
 * that did not lock an account come here: a success and a refusal that locked
 * one are written whatever the count, and sign-in itself is not limited.
 *
 * The summary is ONE row, updated in place as its count grows (its
 * detail.suppressed), not written when the hour closes: a log read during an
 * attack shows it at once, and no job has to close the hour. It is found by
 * its key (target label) and windowStart (detail @>, the GIN index on detail).
 *
 * The counters live in Redis with the window's TTL. Redis down: the row is
 * written and a warning logged; a log that loses refusals because a counter is
 * away would be worse than one that runs long.
 */

export type LoginCapLimits = { perNetwork: number; all: number; windowSeconds: number };

/** The limits in force; replaced by tests that cannot sign in 300 times. */
let limits: LoginCapLimits = { ...ADMIN_AUDIT_LOGIN_REFUSAL_CAP };

export function setLoginCapLimitsForTest(next: LoginCapLimits | null): void {
  limits = next ?? { ...ADMIN_AUDIT_LOGIN_REFUSAL_CAP };
}

const COUNTER_PREFIX = 'audit:login-refused:';
const counterKey = (windowStart: number, key: string) => `${COUNTER_PREFIX}${windowStart}:${key}`;

/** Tests: the counters outlive a test run by up to an hour, so a file that
 *  signs in wrongly starts from zero. */
export async function resetLoginCapCountersForTest(): Promise<void> {
  const keys = await redis.keys(`${COUNTER_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

/** The counter: INCR with the window's TTL on first use. Replaced by a test
 *  that takes Redis away from this path alone (the sign-in's own lock counts
 *  in the same Redis and has to keep working). */
let count = async (key: string, ttl: number): Promise<number> => {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttl);
  return n;
};
const redisCount = count;

export function setLoginCapCounterForTest(next: ((key: string, ttl: number) => Promise<number>) | null): void {
  count = next ?? redisCount;
}

/**
 * true: write this refusal's row. false: it was counted into the summary of
 * its hour instead (written or updated here).
 */
export async function admitRefusedSignIn(network: string, now = Date.now()): Promise<boolean> {
  const windowMs = limits.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const ttl = limits.windowSeconds + 60;
  let over: { key: string; n: number; network: string | null } | null = null;
  try {
    const perNetwork = await count(counterKey(windowStart, `net:${network}`), ttl);
    if (perNetwork > limits.perNetwork) {
      over = { key: network, n: perNetwork - limits.perNetwork, network };
    } else {
      const all = await count(counterKey(windowStart, 'all'), ttl);
      if (all > limits.all) over = { key: 'all', n: all - limits.all, network: null };
    }
  } catch (err) {
    getLogger().warn({ err, event: 'audit.login-cap.unavailable' }, '[audit] the refused sign-in counter is unavailable, the row is written');
    return true;
  }
  if (!over) return true;
  await summarise(over.key, over.network, over.n, new Date(windowStart));
  return false;
}

async function summarise(key: string, network: string | null, suppressed: number, windowStart: Date): Promise<void> {
  const ws = windowStart.toISOString();
  try {
    const [row] = await prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM admin_audit_events
      WHERE action = 'auth.login' AND target_label = ${key}
        AND detail @> ${JSON.stringify({ windowStart: ws })}::jsonb
      ORDER BY id LIMIT 1`;
    const detail = { suppressed, windowStart: ws };
    if (row) {
      await prisma.adminAuditEvent.update({ where: { id: row.id }, data: { detail } });
      return;
    }
    await prisma.adminAuditEvent.create({
      data: {
        at: new Date(),
        actorKind: 'anonymous',
        actorId: null,
        actorLabel: 'anonymous',
        action: 'auth.login',
        targetKind: 'admin',
        targetId: null,
        targetLabel: key,
        outcome: 'refused',
        refusal: null,
        detail,
        sourceNetwork: network,
      },
    });
  } catch (err) {
    getLogger().warn({ err, event: 'audit.login-cap.summary' }, '[audit] the summary of refused sign-ins was not written');
  }
}
