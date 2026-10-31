import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { config } from '../../config.js';
import { generateSecret, generateTotp } from '../../lib/auth/totp.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { DEFAULT_ADMIN, loginAdmin, registerAdmin } from '../../../tests/helpers/auth.js';

/**
 * A-039: an admin could not change their own password; the reset script
 * refuses on production. PUT /api/auth/password changes it under the
 * sign-in's checks and ends every session of the admin issued until then.
 */
let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  const fails = await redis.keys('auth:fail:*');
  if (fails.length > 0) await redis.del(...fails);
  await registerAdmin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const NEW = 'a-new-password-1';
const change = (headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: 'PUT', url: '/api/auth/password', headers, payload: payload as object });
const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });
const login = (password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: DEFAULT_ADMIN.username, password } });

describe('PUT /api/auth/password', () => {
  it('204; the old password no longer signs in, the new one does, and the sessions from before are refused as Bearer and as cookie', async () => {
    const before = await loginAdmin(app);
    const other = await loginAdmin(app);
    const res = await change({ authorization: `Bearer ${before}` }, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW });
    expect(res.statusCode, res.body).toBe(204);
    expect(res.headers['set-cookie']?.toString()).toContain('iceslab_auth=;');

    expect((await login(DEFAULT_ADMIN.password)).statusCode).toBe(401);
    const fresh = await login(NEW);
    expect(fresh.statusCode).toBe(200);

    for (const t of [before, other]) {
      expect((await get('/api/users', { authorization: `Bearer ${t}` })).statusCode).toBe(401);
      expect((await get('/api/users', { cookie: `iceslab_auth=${t}` })).statusCode).toBe(401);
    }
    // Signed in the same second as the change, and still let in: ms, not iat.
    const token = JSON.parse(fresh.body).token as string;
    expect((await get('/api/users', { authorization: `Bearer ${token}` })).statusCode).toBe(200);
  });

  it('a wrong current password is refused with 403 and counted in the sign-in lock of (IP, name)', async () => {
    const token = await loginAdmin(app);
    const res = await change({ authorization: `Bearer ${token}` }, { currentPassword: 'wrong-one', newPassword: NEW });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('INVALID_CURRENT_PASSWORD');
    expect(await redis.get(`auth:fail:127.0.0.1:${DEFAULT_ADMIN.username}`)).toBe('1');

    // The refusal that reaches the limit locks this route and the sign-in alike.
    await redis.set(`auth:fail:127.0.0.1:${DEFAULT_ADMIN.username}`, String(config.LOGIN_LOCKOUT_FAILURES - 1), 'EX', 600);
    expect((await change({ authorization: `Bearer ${token}` }, { currentPassword: 'wrong-two', newPassword: NEW })).statusCode).toBe(403);
    const locked = await change({ authorization: `Bearer ${token}` }, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW });
    expect(locked.statusCode).toBe(429);
    expect(JSON.parse(locked.body).error).toBe('ACCOUNT_LOCKED');
    expect((await login(DEFAULT_ADMIN.password)).statusCode).toBe(429);
    // Nothing changed: the old password is the one stored.
    const admin = await prisma.adminUser.findFirstOrThrow();
    expect(await (await import('bcrypt')).default.compare(DEFAULT_ADMIN.password, admin.passwordHash)).toBe(true);
  });

  it('with 2FA on, no code is refused, a right code goes through', async () => {
    const token = await loginAdmin(app);
    const secret = generateSecret();
    await prisma.adminUser.updateMany({ data: { totpEnabled: true, totpSecret: secret } });
    const headers = { authorization: `Bearer ${token}` };
    const noCode = await change(headers, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW });
    expect(noCode.statusCode).toBe(403);
    expect(JSON.parse(noCode.body)).toMatchObject({ error: 'TOTP_REQUIRED', requires2fa: true });
    const wrong = await change(headers, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW, totpCode: '000000' });
    expect(JSON.parse(wrong.body).error).toBe('INVALID_TOTP');
    const ok = await change(headers, {
      currentPassword: DEFAULT_ADMIN.password,
      newPassword: NEW,
      totpCode: generateTotp(secret, Math.floor(Date.now() / 1000)),
    });
    expect(ok.statusCode, ok.body).toBe(204);
  });

  it('a new password register would refuse is refused, and so is the current one again', async () => {
    const headers = { authorization: `Bearer ${await loginAdmin(app)}` };
    const weak = await change(headers, { currentPassword: DEFAULT_ADMIN.password, newPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    const same = await change(headers, { currentPassword: DEFAULT_ADMIN.password, newPassword: DEFAULT_ADMIN.password });
    expect(same.statusCode).toBe(400);
    expect(JSON.parse(same.body).error).toBe('PASSWORD_UNCHANGED');
  });

  it('an API token is refused with 403, whatever its scopes', async () => {
    const session = await loginAdmin(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'bot' },
    });
    const apiToken = JSON.parse(created.body).token as string;
    const res = await change({ authorization: `Bearer ${apiToken}` }, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('writes admin.password.change: ok on a change, refused with its code on a wrong password, never a password', async () => {
    const headers = { authorization: `Bearer ${await loginAdmin(app)}` };
    await change(headers, { currentPassword: 'wrong-one', newPassword: NEW });
    await change(headers, { currentPassword: DEFAULT_ADMIN.password, newPassword: NEW });
    const rows = await prisma.adminAuditEvent.findMany({ where: { action: 'admin.password.change' }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.outcome, r.refusal, r.targetKind, r.detail])).toEqual([
      ['refused', 'INVALID_CURRENT_PASSWORD', 'admin', null],
      ['ok', null, 'admin', null],
    ]);
    const written = JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(written).not.toContain(NEW);
    expect(written).not.toContain(DEFAULT_ADMIN.password);
  });
});
