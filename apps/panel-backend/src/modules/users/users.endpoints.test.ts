import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * GET /api/users/:id/endpoints, the list behind the user card's Copy buttons.
 *
 * Stand, 2026-09-23: every AmneziaWG row copied an empty string, because
 * AmneziaWG has no URI scheme and the endpoint carries "" in every format. The
 * card now gets the link to that node's .conf instead, and a link is only worth
 * copying if it opens the RIGHT node, so that is what is checked: two nodes,
 * two links, and each one fetched.
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

async function post(url: string, payload: Record<string, unknown>): Promise<{ id: string; subscriptionToken?: string }> {
  const res = await app.inject({ method: 'POST', url, headers: auth(), payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(201);
  return JSON.parse(res.body);
}

describe('the endpoints a user card copies', () => {
  it('gives each AmneziaWG row the link to its own node, and each link opens that node', async () => {
    const user = await post('/api/users', { username: 'awg-copy' });
    const de = await post('/api/nodes', { name: 'awg-de', address: '10.0.0.11:8443' });
    const nl = await post('/api/nodes', { name: 'awg-nl', address: '10.0.0.12:8443' });
    const profile = await post('/api/profiles', {
      name: 'awg-both',
      protocol: 'amneziawg',
      config: {
        subnet: '10.66.66.0/24',
        serverPrivateKey: 'a'.repeat(44),
        serverPublicKey: 'b'.repeat(44),
        obfuscation: {},
      },
    });
    await post('/api/bindings', { profileId: profile.id, nodeId: de.id, port: 51820 });
    await post('/api/bindings', { profileId: profile.id, nodeId: nl.id, port: 51821 });

    const res = await app.inject({ method: 'GET', url: `/api/users/${user.id}/endpoints`, headers: auth() });
    expect(res.statusCode, res.body).toBe(200);
    const awg = (JSON.parse(res.body).endpoints as { protocol: string; nodeId: string; uri: string }[]).filter(
      (e) => e.protocol === 'amneziawg',
    );
    expect(awg).toHaveLength(2);

    const uris = awg.map((e) => e.uri);
    expect(new Set(uris).size, 'two nodes, one link: both Copy buttons would hand out the same tunnel').toBe(2);

    for (const e of awg) {
      expect(e.uri, 'a Copy button that copies nothing').not.toBe('');
      const url = new URL(e.uri);
      expect(url.pathname).toBe(`/sub/${user.subscriptionToken}`);
      expect(url.searchParams.get('format')).toBe('wgconf');

      // The link is only right if it opens the node it sits next to.
      const conf = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
      expect(conf.statusCode, conf.body).toBe(200);
      expect(conf.body).toContain('[Interface]');
      const want = e.nodeId === de.id ? 'Endpoint = 10.0.0.11:51820' : 'Endpoint = 10.0.0.12:51821';
      expect(conf.body).toContain(want);
    }

    // Only the panel's list learns the link. The subscription formats keep ""
    // for AmneziaWG: a subscriber's client has no use for a link to itself.
    const sub = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
      headers: { accept: 'application/json' },
    });
    const inFormat = (JSON.parse(sub.body).endpoints as { protocol: string; uri: string }[]).filter(
      (e) => e.protocol === 'amneziawg',
    );
    expect(inFormat.map((e) => e.uri)).toEqual(['', '']);
  });

  it('tells two xray doors of one node apart by subprotocol', async () => {
    const user = await post('/api/users', { username: 'two-doors' });
    const node = await post('/api/nodes', { name: 'xr-de', address: '10.0.0.31:8443', protocol: 'xray' });
    const vless = await post('/api/profiles', {
      name: 'vless-x',
      protocol: 'xray',
      config: {
        security: 'reality',
        realityDest: 'www.microsoft.com:443',
        realityServerNames: ['www.microsoft.com'],
        realityPrivateKey: 'k'.repeat(43),
        realityPublicKey: 'p'.repeat(43),
        realityShortIds: ['0123abcd'],
        network: 'raw',
      },
    });
    const socks = await post('/api/profiles', {
      name: 'socks-x',
      protocol: 'xray',
      config: { subprotocol: 'socks', security: 'none', network: 'raw' },
    });
    await post('/api/bindings', { profileId: vless.id, nodeId: node.id, port: 443 });
    await post('/api/bindings', { profileId: socks.id, nodeId: node.id, port: 1080 });

    const res = await app.inject({ method: 'GET', url: `/api/users/${user.id}/endpoints`, headers: auth() });
    const rows = (JSON.parse(res.body).endpoints as { protocol: string; nodeId: string; subprotocol?: string; uri: string }[])
      .filter((e) => e.nodeId === node.id);
    expect(rows.map((r) => r.subprotocol).sort()).toEqual(['socks', 'vless']);
    expect(rows.find((r) => r.subprotocol === 'socks')?.uri).toMatch(/^socks:\/\//);
  });

  it('keeps every other protocol on the URI the formats already give it', async () => {
    const user = await post('/api/users', { username: 'hy-copy' });
    // A name ACME can take: native hysteria is not saved onto an IP (E30b).
    const node = await post('/api/nodes', { name: 'hy-de', address: 'hy-de.fixture.test:8443' });
    const profile = await post('/api/profiles', { name: 'hy', protocol: 'hysteria', config: {} });
    await post('/api/bindings', { profileId: profile.id, nodeId: node.id, port: 443 });

    const res = await app.inject({ method: 'GET', url: `/api/users/${user.id}/endpoints`, headers: auth() });
    const hy = (JSON.parse(res.body).endpoints as { protocol: string; uri: string }[]).find(
      (e) => e.protocol === 'hysteria',
    );
    expect(hy?.uri).toMatch(/^hysteria2:\/\//);
  });
});
