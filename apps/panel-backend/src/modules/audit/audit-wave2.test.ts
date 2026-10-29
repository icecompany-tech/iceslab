import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdminAuditDetails, AdminAuditEventDto, AdminAuditListResponse } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { config } from '../../config.js';
import { generateTotp } from '../../lib/auth/totp.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { resetLoginCapCountersForTest } from './login-cap.js';

vi.mock('../../lib/notify/telegram-notify.js', async (real) => ({
  ...(await real<typeof import('../../lib/notify/telegram-notify.js')>()),
  notifyTelegramAsync: () => undefined,
}));

/**
 * The admin audit log, wave 2 (decisions 27.10): sign-in with the network it
 * came from and never finer, sign-up, the second factor, API tokens, panel
 * settings by the names that changed, and a bulk user action as one row that
 * every user it reached finds in their history.
 */
let app: FastifyInstance;
let admin: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  await redis.del('auth:fail:127.0.0.1:admin');
  // A-288: the hour's counters of refused sign-ins outlive a run.
  await resetLoginCapCountersForTest();
  admin = await registerAndLogin(app);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, bearer = admin) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload !== undefined ? { payload } : {}) });

async function list(query = ''): Promise<AdminAuditEventDto[]> {
  const res = await call('GET', `/api/audit?limit=200${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as AdminAuditListResponse).events;
}

const login = (username: string, password: string, totpCode?: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password, ...(totpCode ? { totpCode } : {}) } });

const adminId = async () => (await prisma.adminUser.findFirstOrThrow()).id;

describe('sign-up and sign-in', () => {
  it('the first admin signs up and signs in: two rows, by full name, with the network of the sign-in', async () => {
    const id = await adminId();
    const rows = (await list()).reverse();
    expect(rows.map((r) => r.action)).toEqual(['admin.register', 'auth.login']);
    expect(rows[0]).toMatchObject({ actor: { kind: 'admin', id, label: 'admin' }, target: { kind: 'admin', id, label: 'admin' }, sourceNetwork: null });
    expect(rows[1]).toMatchObject({
      actor: { kind: 'admin', id, label: 'admin' },
      target: { kind: 'admin', id },
      outcome: 'ok',
      detail: { twoFactor: false },
      sourceNetwork: '127.0.0.0/24',
    });
    // The network, never the address.
    const raw = JSON.stringify(await prisma.adminAuditEvent.findMany(), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    expect(raw).not.toContain('127.0.0.1');
  });

  it('a wrong password: refused, by nobody, against the account it named', async () => {
    expect((await login('admin', 'wrong-password')).statusCode).toBe(401);
    const [row] = await list();
    expect(row).toMatchObject({
      action: 'auth.login',
      actor: { kind: 'anonymous', id: null, label: 'anonymous' },
      target: { kind: 'admin', id: await adminId(), label: 'admin' },
      outcome: 'refused',
      refusal: 'INVALID_CREDENTIALS',
      detail: { twoFactor: false },
      sourceNetwork: '127.0.0.0/24',
    });
  });

  it('a name no admin has is not kept as typed: people type passwords into it', async () => {
    expect((await login('hunter2-was-my-password', 'x')).statusCode).toBe(401);
    const [row] = await list();
    expect(row!.target).toEqual({ kind: 'admin', id: null, label: 'unknown account' });
    const raw = JSON.stringify(await prisma.adminAuditEvent.findMany(), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    expect(raw).not.toContain('hunter2');
  });

  it('the refusal that locks the account says so, and the refusals while it holds are not written', async () => {
    // One failure short of the lock, as the service counts them.
    await redis.set('auth:fail:127.0.0.1:admin', String(config.LOGIN_LOCKOUT_FAILURES - 1), 'EX', 600);
    expect((await login('admin', 'wrong-password')).statusCode).toBe(401);
    const locked = (await list()).filter((r) => r.action === 'auth.login' && r.outcome === 'refused');
    expect(locked).toHaveLength(1);
    expect(locked[0]!.detail).toEqual({ twoFactor: false, locked: true });

    expect((await login('admin', 'password123')).statusCode).toBe(429);
    expect((await list()).filter((r) => r.action === 'auth.login' && r.outcome === 'refused')).toHaveLength(1);
    await redis.del('auth:fail:127.0.0.1:admin');
  });

  it('the second factor: enable written, TOTP_REQUIRED not, a wrong code refused with twoFactor, the right one ok', async () => {
    const setup = await call('POST', '/api/auth/2fa/setup');
    const { secret } = JSON.parse(setup.body) as { secret: string };
    expect((await call('POST', '/api/auth/2fa/enable', { code: '000000' })).statusCode).toBe(400);
    const now = Math.floor(Date.now() / 1000);
    expect((await call('POST', '/api/auth/2fa/enable', { code: generateTotp(secret, now) })).statusCode).toBe(200);

    expect((await login('admin', 'password123')).statusCode).toBe(401); // TOTP_REQUIRED
    expect((await login('admin', 'password123', '000000')).statusCode).toBe(401); // INVALID_TOTP
    expect((await login('admin', 'password123', generateTotp(secret, now + 30))).statusCode).toBe(200);

    const rows = (await list()).reverse().slice(2); // after the sign-up and the first sign-in
    expect(rows.map((r) => [r.action, r.outcome, r.refusal])).toEqual([
      ['admin.2fa.enable', 'refused', 'INVALID_TOTP'],
      ['admin.2fa.enable', 'ok', null],
      ['auth.login', 'refused', 'INVALID_TOTP'],
      ['auth.login', 'ok', null],
    ]);
    expect(rows[2]!.detail).toEqual({ twoFactor: true });
    expect(rows[3]!.detail).toEqual({ twoFactor: true });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });
});

describe('API tokens', () => {
  it('create and revoke by name and scopes, never the token', async () => {
    const minted = await call('POST', '/api/api-tokens', { name: 'billing-bot', scopes: ['users:read'] });
    expect(minted.statusCode).toBe(201);
    const { id, token } = JSON.parse(minted.body) as { id: string; token: string };
    const full = await call('POST', '/api/api-tokens', { name: 'ops' });
    expect((await call('DELETE', `/api/api-tokens/${id}`)).statusCode).toBe(204);

    const rows = (await list('&action=apiToken.')).reverse();
    expect(rows.map((r) => [r.action, r.target.label, r.target.id, r.detail])).toEqual([
      ['apiToken.create', 'billing-bot', id, { scopes: ['users:read'] }],
      ['apiToken.create', 'ops', JSON.parse(full.body).id, { scopes: ['*'] }],
      ['apiToken.revoke', 'billing-bot', id, { scopes: ['users:read'] }],
    ]);
    const raw = JSON.stringify(await prisma.adminAuditEvent.findMany(), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    expect(raw).not.toContain(token);
  });

  // AUDT 27.10: the token's name rides in the actor's label, and a long one is
  // cut to the column like every label.
  it('an action by a token names it, cut to the column', async () => {
    const name = 'n'.repeat(64);
    const minted = await call('POST', '/api/api-tokens', { name });
    const token = JSON.parse(minted.body).token as string;
    expect((await call('POST', '/api/users/bulk', { action: 'revoke', userIds: ['00000000-0000-4000-8000-000000000009'] }, token)).statusCode).toBe(200);
    const [row] = await list('&action=users.bulk');
    expect(row!.actor.kind).toBe('api_token');
    expect(row!.actor.label).toHaveLength(64);
    expect(row!.actor.label).toBe(`api token: ${name}`.slice(0, 64));
  });
});

describe('panel settings', () => {
  it('names the settings whose value changed, never the value, and a save that changes nothing leaves no row', async () => {
    expect((await call('PUT', '/api/settings', { brandName: 'North Star', subscriptionSupportUrl: 'https://t.me/support' })).statusCode).toBe(200);
    expect((await call('PUT', '/api/settings', { brandName: 'North Star', subscriptionSupportUrl: 'https://t.me/support' })).statusCode).toBe(200);
    expect((await call('PUT', '/api/settings', { brandName: 'Polaris', subscriptionSupportUrl: 'https://t.me/support' })).statusCode).toBe(200);

    const rows = (await list('&action=settings.update')).reverse();
    expect(rows.map((r) => (r.detail as AdminAuditDetails['settings.update']).changed.sort())).toEqual([
      ['brandName', 'subscriptionSupportUrl'],
      ['brandName'],
    ]);
    expect(rows[0]!.target).toEqual({ kind: 'settings', id: null, label: 'panel settings' });
    expect(JSON.stringify(rows)).not.toMatch(/North Star|Polaris|t\.me/);
  });
});

describe('a bulk user action', () => {
  it('is one row, found in the history of each user it reached and not of one it failed on', async () => {
    const make = async (username: string) => {
      const res = await call('POST', '/api/users', { username });
      expect(res.statusCode, res.body).toBe(201);
      return JSON.parse(res.body).id as string;
    };
    const reached = await make('reached');
    const missed = await make('missed');
    // Extending a deleted user fails, so this one is among the failed.
    expect((await call('DELETE', `/api/users/${missed}`)).statusCode).toBe(204);

    const res = await call('POST', '/api/users/bulk', { action: 'extend', expireDays: 30, userIds: [reached, missed] });
    expect(res.statusCode, res.body).toBe(200);

    const bulk = await list('&action=users.bulk');
    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.detail).toEqual({ action: 'extend', requested: 2, succeeded: 1, failed: 1, expireDays: 30, userIds: [reached] });

    const historyOf = async (id: string) => (await list(`&targetKind=user&targetId=${id}`)).map((r) => r.action);
    expect(await historyOf(reached)).toEqual(['users.bulk']);
    expect(await historyOf(missed)).toEqual(['user.delete']);
  });
});
