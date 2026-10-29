import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_AUDIT_LOGIN_REFUSAL_CAP } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { config } from '../../config.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAdmin } from '../../../tests/helpers/auth.js';
import { resetLoginCapCountersForTest, setLoginCapCounterForTest, setLoginCapLimitsForTest } from './login-cap.js';

vi.mock('../../lib/notify/telegram-notify.js', async (real) => ({
  ...(await real<typeof import('../../lib/notify/telegram-notify.js')>()),
  notifyTelegramAsync: () => undefined,
}));

/**
 * A-288: refused sign-ins are written row by row up to a cap per hour, per
 * network and in all; past it one summary row per hour and key counts them.
 * A success and a refusal that locked an account are always written; with
 * Redis away, every refusal is.
 */
let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  await resetLoginCapCountersForTest();
  setLoginCapLimitsForTest(null);
  await registerAdmin(app);
});

afterEach(async () => {
  vi.restoreAllMocks();
  setLoginCapLimitsForTest(null);
  setLoginCapCounterForTest(null);
  await resetLoginCapCountersForTest();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

/** A sign-in from one address; each from its own, so the route's rate limit
 *  per address (5 a minute) and the lock per address and name stay out. */
const signIn = (ip: string, username: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { username, password } });

const refusals = () =>
  prisma.adminAuditEvent.findMany({ where: { action: 'auth.login', outcome: 'refused' }, orderBy: { id: 'asc' } });

describe('refused sign-ins past the cap of their hour', () => {
  it('25 from one /24: 20 rows and a summary of 5, with the network', async () => {
    expect(ADMIN_AUDIT_LOGIN_REFUSAL_CAP.perNetwork).toBe(20);
    for (let i = 1; i <= 25; i++) {
      expect((await signIn(`203.0.113.${i}`, 'nobody', 'x')).statusCode).toBe(401);
    }
    const rows = await refusals();
    const summaries = rows.filter((r) => (r.detail as { suppressed?: number }).suppressed !== undefined);
    expect(rows.length - summaries.length).toBe(20);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      actorKind: 'anonymous',
      targetLabel: '203.0.113.0/24',
      sourceNetwork: '203.0.113.0/24',
    });
    expect((summaries[0]!.detail as { suppressed: number }).suppressed).toBe(5);
  });

  it('past the cap in all, from many networks: a summary under "all", with no network', async () => {
    setLoginCapLimitsForTest({ perNetwork: 20, all: 5, windowSeconds: 3600 });
    for (let i = 1; i <= 8; i++) {
      expect((await signIn(`198.51.${i}.10`, 'nobody', 'x')).statusCode).toBe(401);
    }
    const rows = await refusals();
    const all = rows.filter((r) => r.targetLabel === 'all');
    expect(rows.length - all.length).toBe(5);
    expect(all).toHaveLength(1);
    expect(all[0]!.sourceNetwork).toBeNull();
    expect((all[0]!.detail as { suppressed: number }).suppressed).toBe(3);
  });

  it('a success and a refusal that locks are written past the cap', async () => {
    setLoginCapLimitsForTest({ perNetwork: 1, all: 1, windowSeconds: 3600 });
    expect((await signIn('192.0.2.1', 'nobody', 'x')).statusCode).toBe(401);
    expect((await signIn('192.0.2.2', 'nobody', 'x')).statusCode).toBe(401); // counted, not written
    expect((await signIn('192.0.2.3', 'admin', 'password123')).statusCode).toBe(200);
    await redis.set('auth:fail:192.0.2.4:admin', String(config.LOGIN_LOCKOUT_FAILURES - 1), 'EX', 600);
    expect((await signIn('192.0.2.4', 'admin', 'wrong')).statusCode).toBe(401);
    await redis.del('auth:fail:192.0.2.4:admin');

    const logins = await prisma.adminAuditEvent.findMany({ where: { action: 'auth.login' }, orderBy: { id: 'asc' } });
    expect(logins.some((r) => r.outcome === 'ok')).toBe(true);
    expect(logins.some((r) => (r.detail as { locked?: boolean }).locked === true)).toBe(true);
  });

  it('with Redis away every refusal is written', async () => {
    setLoginCapLimitsForTest({ perNetwork: 1, all: 1, windowSeconds: 3600 });
    setLoginCapCounterForTest(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    for (let i = 1; i <= 3; i++) {
      expect((await signIn(`192.0.2.${10 + i}`, 'nobody', 'x')).statusCode).toBe(401);
    }
    const rows = await refusals();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => (r.detail as { suppressed?: number }).suppressed === undefined)).toBe(true);
  });
});
