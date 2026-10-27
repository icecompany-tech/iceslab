import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * A-109: a token with restricted scopes read every profile's server keys.
 * Now it reads without them, a write of such a token that leaves a key out
 * keeps the stored one, and the chain password needs nodes:write like the
 * bootstrap. Sessions and full tokens are unchanged.
 */

let app: FastifyInstance;
let session: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  session = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const PRIVATE = 'k'.repeat(43);
const REALITY = {
  subprotocol: 'vless',
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: PRIVATE,
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

async function mint(name: string, scopes?: string[]): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/api-tokens',
    headers: { authorization: `Bearer ${session}` },
    payload: { name, ...(scopes ? { scopes } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).token as string;
}

async function profile(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: { authorization: `Bearer ${session}` },
    payload: { name: 'p', protocol: 'xray', config: REALITY },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const get = (url: string, bearer: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${bearer}` } });

describe('server secrets and restricted tokens', () => {
  it('a profiles:read token reads profiles without the keys; a full token and the session see them', async () => {
    const id = await profile();
    const reader = await mint('dash', ['profiles:read']);
    for (const url of [`/api/profiles/${id}`, '/api/profiles']) {
      const res = await get(url, reader);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body, url).not.toContain(PRIVATE);
      expect(res.body, url).not.toContain('realityPrivateKey');
      expect(res.body, url).toContain('realityPublicKey');
    }
    const full = await mint('full');
    expect((await get(`/api/profiles/${id}`, full)).body).toContain(PRIVATE);
    expect((await get(`/api/profiles/${id}`, session)).body).toContain(PRIVATE);
  });

  it('a profiles:write token that writes back what it read keeps the stored key', async () => {
    const id = await profile();
    const writer = await mint('bot', ['profiles:read', 'profiles:write']);
    const read = JSON.parse((await get(`/api/profiles/${id}`, writer)).body) as { config: Record<string, unknown> };
    expect(read.config.realityPrivateKey).toBeUndefined();
    const put = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${id}`,
      headers: { authorization: `Bearer ${writer}` },
      payload: { config: { ...read.config, realityShortIds: ['89abcdef'] } },
    });
    expect(put.statusCode, put.body).toBe(200);
    const stored = (await prisma.profile.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;
    expect(stored.realityPrivateKey).toBe(PRIVATE);
    expect(stored.realityShortIds).toEqual(['89abcdef']);
  });

  it('the legacy inbounds PUT is not mounted, so no token writes an inbound config at all', async () => {
    // Slice 27 retired the route, A-281 removed it, its table and its scope:
    // a token can no longer be minted with it.
    const refused = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'inb', scopes: ['inbounds:read', 'inbounds:write'] },
    });
    expect(refused.statusCode).toBe(400);
    const writer = await mint('full');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/inbounds/00000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${writer}` },
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(404);
    expect(app.hasRoute({ method: 'PUT', url: '/api/inbounds/:id' })).toBe(false);
  });

  it('a named-outbounds token reads a socks way out without its upstream password, and a write keeps it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/named-outbounds',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'up', type: 'socks', config: { server: '203.0.113.5', port: 1080, username: 'u', password: 'upstream-secret' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    const bot = await mint('no-bot', ['named-outbounds:read', 'named-outbounds:write']);
    for (const url of [`/api/named-outbounds/${id}`, '/api/named-outbounds']) {
      expect((await get(url, bot)).body, url).not.toContain('upstream-secret');
    }
    expect((await get(`/api/named-outbounds/${id}`, session)).body).toContain('upstream-secret');

    const read = JSON.parse((await get(`/api/named-outbounds/${id}`, bot)).body) as { config: Record<string, unknown> };
    const put = await app.inject({
      method: 'PUT',
      url: `/api/named-outbounds/${id}`,
      headers: { authorization: `Bearer ${bot}` },
      payload: { config: { ...read.config, port: 1081 } },
    });
    expect(put.statusCode, put.body).toBe(200);
    // The answer to the write must not hand back the password the write kept.
    expect(put.body).not.toContain('upstream-secret');
    const stored = (await prisma.namedOutbound.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;
    expect(stored.password).toBe('upstream-secret');
    expect(stored.port).toBe(1081);

    // The session's answer to the same write still carries it.
    const asSession = await app.inject({
      method: 'PUT',
      url: `/api/named-outbounds/${id}`,
      headers: { authorization: `Bearer ${session}` },
      payload: { countryCode: 'DE' },
    });
    expect(asSession.statusCode, asSession.body).toBe(200);
    expect(asSession.body).toContain('upstream-secret');

    // And a create by the token answers without what it just sent.
    const created2 = await app.inject({
      method: 'POST',
      url: '/api/named-outbounds',
      headers: { authorization: `Bearer ${bot}` },
      payload: { name: 'up2', type: 'socks', config: { server: '203.0.113.6', port: 1080, username: 'u', password: 'second-secret' } },
    });
    expect(created2.statusCode, created2.body).toBe(201);
    expect(created2.body).not.toContain('second-secret');
  });

  it('the chain password needs nodes:write, as the bootstrap does', async () => {
    const node = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'n1', address: 'n1.test' },
    });
    const nodeId = JSON.parse(node.body).id as string;
    const reader = await mint('nodes-r', ['nodes:read']);
    const res = await get(`/api/nodes/${nodeId}/chain-secret`, reader);
    expect(res.statusCode, res.body).toBe(403);
    expect(JSON.parse(res.body).message).toContain('nodes:write');
    const writer = await mint('nodes-w', ['nodes:write']);
    expect((await get(`/api/nodes/${nodeId}/chain-secret`, writer)).statusCode).not.toBe(403);
  });
});
