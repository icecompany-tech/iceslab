import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
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
      { sub: '00000000-0000-4000-8000-000000000000', role: 'admin' },
      { expiresIn: -60 },
    );
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: `iceslab_auth=${expired}` } });
    expect(res.statusCode).toBe(204);
    expect(parseSetCookie(res.headers['set-cookie']).some((c) => c.name === 'iceslab_auth')).toBe(true);
  });
});
