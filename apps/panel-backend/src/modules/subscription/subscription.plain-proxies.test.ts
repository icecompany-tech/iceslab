import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FORMAT_NAMES } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * The Telegram doors (SOCKS5 / HTTP on xray, 23.09) end to end through the
 * subscription: who gets them, in which formats, and who gets nothing.
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

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers: auth(), payload });
  expect(res.statusCode, `${url} -> ${res.body}`).toBe(201);
  return JSON.parse(res.body);
}

async function seed() {
  const node = await post('/api/nodes', { name: 'tg-de', address: 'tg-de.example.com', protocol: 'xray' });
  const vless = await post('/api/profiles', {
    name: 'vless-main',
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
    name: 'tg-socks',
    protocol: 'xray',
    config: { subprotocol: 'socks', security: 'none', network: 'raw' },
  });
  const http = await post('/api/profiles', {
    name: 'tg-http',
    protocol: 'xray',
    config: { subprotocol: 'http', security: 'none', network: 'raw' },
  });
  await post('/api/hosts', { profileId: vless.id, nodeId: node.id, port: 443, remark: 'vless' });
  await post('/api/hosts', { profileId: socks.id, nodeId: node.id, port: 1080, remark: 'socks' });
  await post('/api/hosts', { profileId: http.id, nodeId: node.id, port: 3128, remark: 'http' });
  const withTg = await post('/api/squads', { name: 'with-tg', profileIds: [vless.id, socks.id, http.id] });
  const withoutTg = await post('/api/squads', { name: 'without-tg', profileIds: [vless.id] });
  const alice = await post('/api/users', { username: 'alice', groupIds: [withTg.id] });
  const bob = await post('/api/users', { username: 'bob', groupIds: [withoutTg.id] });
  return { alice, bob };
}

async function sub(tokenOf: string, format?: string, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: 'GET',
    url: `/sub/${tokenOf}${format ? `?format=${format}` : ''}`,
    headers,
  });
  expect(res.statusCode, `${format}: ${res.body}`).toBe(200);
  return format === 'plain' || format === undefined
    ? Buffer.from(res.body, 'base64').toString('utf8')
    : res.body;
}

describe('the Telegram doors in the subscription', () => {
  it('hands alice her own socks and http, in plain, clash, sing-box and xray-json', async () => {
    const { alice } = await seed();
    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: alice.id }, select: { xrayUuid: true } });

    const plain = await sub(alice.subscriptionToken, 'plain');
    const b64 = Buffer.from(`alice:${persisted.xrayUuid}`).toString('base64');
    expect(plain).toContain(`socks://${b64}@tg-de.example.com:1080`);
    expect(plain).toContain(`http://alice:${persisted.xrayUuid}@tg-de.example.com:3128`);

    expect(await sub(alice.subscriptionToken, 'clash')).toMatch(/type: socks5[\s\S]*port: 1080/);
    expect(await sub(alice.subscriptionToken, 'singbox')).toContain('"type": "socks"');
    expect(await sub(alice.subscriptionToken, 'xrayjson')).toContain('"protocol": "http"');
  });

  it('gives bob, whose squads hold no socks profile, not one socks or http line in any format', async () => {
    // The test asked for on 23.09. Every format the route serves, and the page.
    const { bob } = await seed();
    for (const format of FORMAT_NAMES) {
      const body = await sub(bob.subscriptionToken, format);
      // Word boundaries: xray-json carries the client's own local socks inbound
      // on 10808, which is not a leak and contains "1080".
      for (const leak of [/socks:\/\//, /http:\/\/bob/, /tg:\/\/socks/, /socks5/, /\b1080\b/, /\b3128\b/]) {
        expect(body, `${format} carries ${leak}`).not.toMatch(leak);
      }
    }
    const page = await sub(bob.subscriptionToken, undefined, { accept: 'text/html' });
    expect(page).not.toContain('tg://socks');
    expect(page).not.toContain('Telegram, HTTP');
  });

  it('puts the tg://socks link on alice\'s page, and the four HTTP fields for Desktop', async () => {
    const { alice } = await seed();
    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: alice.id }, select: { xrayUuid: true } });
    const res = await app.inject({
      method: 'GET',
      url: `/sub/${alice.subscriptionToken}?lang=en`,
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain(
      `tg://socks?server=tg-de.example.com&amp;port=1080&amp;user=alice&amp;pass=${persisted.xrayUuid}`,
    );
    expect(html).toContain('Telegram Desktop only');
    expect(html).toContain(`<code>3128</code>`);
    expect(html).toContain(`<code>alice</code>`);
  });
});
