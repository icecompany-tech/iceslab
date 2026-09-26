import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * Phase 10 (Э3.2): named foreign outbounds, the API alone. Standing a
 * direction on one is commit (2); here a direction is pointed at one in the
 * database, to test what the API says about an outbound in use.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: auth(), ...(payload ? { payload } : {}) });

const VLESS_REALITY = {
  server: 'ch.example.net',
  port: 443,
  uuid: '6e1e9f7e-3f0b-4a55-9d6e-0f3e9a1c2b7d',
  flow: 'xtls-rprx-vision',
  security: 'reality',
  sni: 'www.microsoft.com',
  fingerprint: 'firefox',
  realityPublicKey: 'A'.repeat(43),
  realityShortId: '0123abcd',
};
const SOCKS = { server: '203.0.113.7', port: 1080, username: 'op', password: 'secret' };

async function create(payload: object) {
  const res = await req('POST', '/api/named-outbounds', payload);
  return { res, body: JSON.parse(res.body) };
}

describe('named outbounds', () => {
  it('creates one of each type and hands the config back whole, secrets included', async () => {
    const vless = await create({ name: 'ch', type: 'vless', countryCode: 'ch', config: VLESS_REALITY });
    expect(vless.res.statusCode, vless.res.body).toBe(201);
    expect(vless.body).toMatchObject({ name: 'ch', type: 'vless', countryCode: 'CH', usedBy: [] });
    expect(vless.body.config).toEqual(VLESS_REALITY);

    const socks = await create({ name: 'georgia', type: 'socks', config: SOCKS });
    expect(socks.res.statusCode, socks.res.body).toBe(201);
    expect(socks.body.config.password).toBe('secret');
    expect(socks.body.countryCode).toBeNull();

    for (const type of ['freedom', 'blackhole']) {
      const r = await create({ name: `x-${type}`, type });
      expect(r.res.statusCode, r.res.body).toBe(201);
      expect(r.body.config).toEqual({});
    }

    const list = JSON.parse((await req('GET', '/api/named-outbounds')).body).outbounds as { name: string }[];
    expect(list.map((o) => o.name)).toEqual(['ch', 'georgia', 'x-blackhole', 'x-freedom']);
  });

  it('fills vless flow as null when absent', async () => {
    const { flow: _f, ...noFlow } = VLESS_REALITY;
    const r = await create({ name: 'tr', type: 'vless', config: noFlow });
    expect(r.res.statusCode, r.res.body).toBe(201);
    expect(r.body.config.flow).toBeNull();
  });

  it.each([
    ['REALITY without its public key', 'vless', { ...VLESS_REALITY, realityPublicKey: undefined }],
    ['REALITY without a short id', 'vless', { ...VLESS_REALITY, realityShortId: undefined }],
    ['Vision over plain TCP', 'vless', { server: 'a.b', port: 1, uuid: VLESS_REALITY.uuid, flow: 'xtls-rprx-vision', security: 'none' }],
    ['a REALITY key on TLS', 'vless', { ...VLESS_REALITY, security: 'tls' }],
    ['a transport the set does not have', 'vless', { ...VLESS_REALITY, network: 'ws' }],
    ['a port out of range', 'socks', { ...SOCKS, port: 70000 }],
    ['a username without a password', 'socks', { server: 'a.b', port: 1080, username: 'op' }],
    ['socks4', 'socks', { ...SOCKS, version: '4' }],
    ['a field on freedom', 'freedom', { server: 'a.b' }],
    ['a type the set does not have', 'hysteria', {}],
  ])('refuses %s', async (_what, type, config) => {
    const r = await create({ name: 'bad', type, config });
    expect(r.res.statusCode, r.res.body).toBe(400);
  });

  it('refuses a name taken, and a name not written as a key', async () => {
    expect((await create({ name: 'ch', type: 'socks', config: SOCKS })).res.statusCode).toBe(201);
    const again = await create({ name: 'ch', type: 'socks', config: SOCKS });
    expect(again.res.statusCode).toBe(409);
    expect(again.body).toMatchObject({ error: 'NAMED_OUTBOUND_NAME_TAKEN', name: 'ch' });
    expect((await create({ name: 'Swiss Exit', type: 'socks', config: SOCKS })).res.statusCode).toBe(400);
  });

  it('a PUT: type and config together, checked against the new type', async () => {
    const { body } = await create({ name: 'kz', type: 'socks', config: SOCKS });
    const put = (payload: object) => req('PUT', `/api/named-outbounds/${body.id}`, payload);

    expect((await put({ type: 'vless' })).statusCode).toBe(400); // a type with no config
    const bad = await put({ type: 'vless', config: SOCKS });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(JSON.parse(bad.body).error).toBe('VALIDATION');

    const ok = await put({ type: 'vless', config: VLESS_REALITY });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ type: 'vless', name: 'kz' });

    // Absent is untouched: a rename leaves the config and the country alone.
    const renamed = JSON.parse((await put({ name: 'kz-2' })).body);
    expect(renamed.config).toEqual(VLESS_REALITY);
    expect((await put({ countryCode: 'kz' })).statusCode).toBe(200);
    expect(JSON.parse((await req('GET', `/api/named-outbounds/${body.id}`)).body).countryCode).toBe('KZ');
    expect(JSON.parse((await put({ countryCode: null })).body).countryCode).toBeNull();
  });

  describe('in use by a direction', () => {
    async function standOn(outboundId: string) {
      seq += 1;
      const node = async (name: string) =>
        JSON.parse((await req('POST', '/api/nodes', { name, address: `${name}-${seq}.test`, protocol: 'xray' })).body)
          .id as string;
      const c = await req('POST', '/api/cascades', {
        name: `ru-out-${seq}`,
        enabled: true,
        positions: [{ position: 0, nodeIds: [await node('ru')], entryProtocol: 'xray', linkProtocol: 'vless' }],
        directions: [{ countryCode: 'NL', nodeIds: [await node('nl')] }],
      });
      expect(c.statusCode, c.body).toBe(201);
      const cascadeId = JSON.parse(c.body).id as string;
      await prisma.cascadeDirection.updateMany({ where: { cascadeId }, data: { outboundId } });
      return cascadeId;
    }

    it('lists the directions standing on it and refuses its DELETE, naming them', async () => {
      const { body } = await create({ name: 'ch', type: 'vless', config: VLESS_REALITY });
      const cascadeId = await standOn(body.id);
      const got = JSON.parse((await req('GET', `/api/named-outbounds/${body.id}`)).body);
      expect(got.usedBy).toEqual([{ cascadeId, cascadeName: 'ru-out-1', directionTag: 1 }]);

      const del = await req('DELETE', `/api/named-outbounds/${body.id}`);
      expect(del.statusCode, del.body).toBe(409);
      expect(JSON.parse(del.body)).toMatchObject({ error: 'NAMED_OUTBOUND_IN_USE', usedBy: got.usedBy });
      expect(await prisma.namedOutbound.count()).toBe(1);
    });

    it('lets its type change between vless and socks, not onto freedom or blackhole', async () => {
      const { body } = await create({ name: 'ch', type: 'vless', config: VLESS_REALITY });
      await standOn(body.id);
      const put = (payload: object) => req('PUT', `/api/named-outbounds/${body.id}`, payload);
      expect((await put({ type: 'socks', config: SOCKS })).statusCode).toBe(200);
      const off = await put({ type: 'freedom', config: {} });
      expect(off.statusCode, off.body).toBe(409);
      expect(JSON.parse(off.body)).toMatchObject({ error: 'NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION', type: 'freedom' });
    });

    it('deletes one nothing stands on', async () => {
      const { body } = await create({ name: 'lv', type: 'socks', config: SOCKS });
      expect((await req('DELETE', `/api/named-outbounds/${body.id}`)).statusCode).toBe(204);
      expect((await req('GET', `/api/named-outbounds/${body.id}`)).statusCode).toBe(404);
    });
  });
});
