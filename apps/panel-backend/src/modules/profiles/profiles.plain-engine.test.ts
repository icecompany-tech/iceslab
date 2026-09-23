import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * socks and http run in the xray process and nowhere else (23.09: one process,
 * no new adapters). The sing-box adapter refuses them on the node, but that is
 * a failed push hours later; the save says it while the operator is on the form.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });
const socks = { subprotocol: 'socks', security: 'none', network: 'raw' };

describe('the engine of a socks or http profile', () => {
  it('saves on the native xray engine', async () => {
    for (const engine of [undefined, 'xray']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: auth(),
        payload: { name: `tg-socks-${engine ?? 'native'}`, protocol: 'xray', engine, config: socks },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
  });

  it('refuses sing-box on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'tg-http-sb', protocol: 'xray', engine: 'singbox', config: { ...socks, subprotocol: 'http' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('xray engine only');
  });

  it('stores the config as three keys on create, and an edit with extra keys keeps it three', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'tg-socks-3', protocol: 'xray', config: socks },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    const three = { subprotocol: 'socks', security: 'none', network: 'raw' };
    expect((await prisma.profile.findUniqueOrThrow({ where: { id } })).config).toEqual(three);
    expect(JSON.parse(created.body).config).toEqual(three);

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${id}`,
      headers: auth(),
      payload: { config: { ...socks, flow: 'xtls-rprx-vision', fingerprint: 'chrome', udp: true } },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await prisma.profile.findUniqueOrThrow({ where: { id } })).config).toEqual(three);
  });

  it('refuses moving an existing socks profile onto sing-box', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'tg-socks', protocol: 'xray', config: socks },
    });
    const id = JSON.parse(created.body).id as string;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${id}`,
      headers: auth(),
      payload: { engine: 'singbox' },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID');
    const stored = await prisma.profile.findUniqueOrThrow({ where: { id } });
    expect(stored.engine).toBeNull();
  });
});
