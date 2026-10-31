import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAdmin } from '../../../tests/helpers/auth.js';

/**
 * A-038: there was no way to end a session on the server, nothing in the
 * backend cleared the cookie the login sets. POST /api/auth/logout clears it
 * with the attributes it was set with, so the browser drops it.
 */
let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

type Cookie = { name: string; value: string; attrs: Map<string, string> };

function parseSetCookie(header: string | string[] | undefined): Cookie[] {
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => {
    const [pair, ...rest] = line.split(';').map((s) => s.trim());
    const eq = pair!.indexOf('=');
    const attrs = new Map<string, string>();
    for (const a of rest) {
      const i = a.indexOf('=');
      attrs.set((i < 0 ? a : a.slice(0, i)).toLowerCase(), i < 0 ? '' : a.slice(i + 1));
    }
    return { name: pair!.slice(0, eq), value: pair!.slice(eq + 1), attrs };
  });
}

/** What a browser keeps after a Set-Cookie: dropped when it expires now. */
function applyToJar(jar: Map<string, string>, cookies: Cookie[]): void {
  for (const c of cookies) {
    const maxAge = c.attrs.get('max-age');
    const expires = c.attrs.get('expires');
    const gone = (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) <= Date.now());
    if (gone) jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
}
const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

describe('POST /api/auth/logout', () => {
  it('sign in, sign out, then GET /api/users with only the cookie is 401', async () => {
    await registerAdmin(app);
    const jar = new Map<string, string>();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password123' },
    });
    expect(login.statusCode, login.body).toBe(200);
    const set = parseSetCookie(login.headers['set-cookie']);
    applyToJar(jar, set);
    expect(jar.has('iceslab_auth')).toBe(true);

    const before = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: cookieHeader(jar) } });
    expect(before.statusCode, 'the cookie alone signs in').toBe(200);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookieHeader(jar) } });
    expect(out.statusCode).toBe(204);
    const cleared = parseSetCookie(out.headers['set-cookie']).find((c) => c.name === 'iceslab_auth');
    const setAttrs = set.find((c) => c.name === 'iceslab_auth')!.attrs;
    // The browser clears only a cookie named with the same path and domain.
    for (const a of ['path', 'domain', 'httponly', 'samesite', 'secure']) {
      expect(cleared?.attrs.get(a), a).toBe(setAttrs.get(a));
    }
    applyToJar(jar, cleared ? [cleared] : []);
    expect(jar.has('iceslab_auth')).toBe(false);

    const after = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: cookieHeader(jar) } });
    expect(after.statusCode).toBe(401);
  });

  it('works without a session and with an expired cookie', async () => {
    const none = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(none.statusCode).toBe(204);

    const expired = app.jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000000', role: 'admin', jti: 'expired' },
      { expiresIn: -60 },
    );
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: `iceslab_auth=${expired}` } });
    expect(res.statusCode).toBe(204);
    expect(parseSetCookie(res.headers['set-cookie']).some((c) => c.name === 'iceslab_auth')).toBe(true);
  });
});

/**
 * A-038, the tail: clearing the browser's cookie left the token itself alive
 * to its expiry, so a copy of it (stolen, or kept in another place) still
 * signed in. Sign-out now revokes the token's jti until then.
 */
describe('a token after sign-out', () => {
  async function signIn(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password123' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body).token as string;
  }
  const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

  it('a cookie copied before sign-out is refused after it, on the API and on /admin/queues', async () => {
    await registerAdmin(app);
    const copy = { cookie: `iceslab_auth=${await signIn()}` };
    expect((await get('/api/users', copy)).statusCode).toBe(200);
    expect((await get('/admin/queues', copy)).statusCode, 'bull-board takes the cookie').not.toBe(401);

    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: copy })).statusCode).toBe(204);

    expect((await get('/api/users', copy)).statusCode).toBe(401);
    expect((await get('/admin/queues', copy)).statusCode).toBe(401);
  });

  it('the same for a Bearer token signed out by its header', async () => {
    await registerAdmin(app);
    const bearer = { authorization: `Bearer ${await signIn()}` };
    expect((await get('/api/users', bearer)).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer });
    expect((await get('/api/users', bearer)).statusCode).toBe(401);
    // And as a cookie: one token, one revocation.
    expect((await get('/api/users', { cookie: `iceslab_auth=${bearer.authorization.slice(7)}` })).statusCode).toBe(401);
  });

  it('another session of the same admin, not signed out, goes on working', async () => {
    await registerAdmin(app);
    const here = { authorization: `Bearer ${await signIn()}` };
    const there = { authorization: `Bearer ${await signIn()}` };
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: here });
    expect((await get('/api/users', here)).statusCode).toBe(401);
    expect((await get('/api/users', there)).statusCode).toBe(200);
  });

  it('the revocation lives until the token would have expired, and no longer', async () => {
    await registerAdmin(app);
    const token = await signIn();
    const { jti, exp } = app.jwt.decode<{ jti: string; exp: number }>(token)!;
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    const ttl = await redis.ttl(`auth:revoked:${jti}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(exp - Math.floor(Date.now() / 1000) + 1);
  });

  it('a token without a jti (signed before this version) is refused', async () => {
    await registerAdmin(app);
    const admin = await prisma.adminUser.findFirstOrThrow({ select: { id: true } });
    const old = app.jwt.sign({ sub: admin.id, role: 'admin' } as never);
    expect((await get('/api/users', { authorization: `Bearer ${old}` })).statusCode).toBe(401);
  });

  it('Redis not answering at the check is a 503, not a pass', async () => {
    await registerAdmin(app);
    const bearer = { authorization: `Bearer ${await signIn()}` };
    vi.spyOn(redis, 'mget').mockRejectedValue(new Error('Connection is closed.'));
    const res = await get('/api/users', bearer);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe('AUTH_UNAVAILABLE');
  });

  it('Redis that holds the check without answering is a 503 after the wait, not a hang', async () => {
    await registerAdmin(app);
    const bearer = { authorization: `Bearer ${await signIn()}` };
    // ioredis queues commands while it reconnects and never gives up on them.
    vi.spyOn(redis, 'mget').mockReturnValue(new Promise(() => {}) as never);
    const t0 = Date.now();
    const res = await get('/api/users', bearer);
    expect(res.statusCode).toBe(503);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
