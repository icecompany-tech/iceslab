import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { applyInboundsRequestForNode, inboundSyncQueue } from '../inbounds/inbounds.queue.js';
import { canonicalJson, requestFingerprint } from '../inbounds/render-drift.js';
import { nodeUsersQueue } from '../users/users.queue.js';

/**
 * Bk-170: an xray profile carries the inbound's socket options, nothing sets them
 * by default, the old form's save does not erase them, and the push hands them to
 * the agent exactly as stored. The render and the live run are the agent's
 * (apps/node/internal/core/xray/sockopt_test.go, sockopt_live_test.go).
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  vi.spyOn(inboundSyncQueue, 'add').mockResolvedValue({} as never);
  vi.spyOn(nodeUsersQueue, 'add').mockResolvedValue({} as never);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

const reality = {
  subprotocol: 'vless',
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};
const set = { tcpUserTimeout: 15000, tcpKeepAliveIdle: 30, tcpKeepAliveInterval: 10 };

function create(config: Record<string, unknown>, engine?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: `p-${randomBytes(4).toString('hex')}`, protocol: 'xray', engine, config },
  });
}

function edit(id: string, payload: unknown) {
  return app.inject({ method: 'PUT', url: `/api/profiles/${id}`, headers: auth(), payload });
}

async function stored(id: string): Promise<Record<string, unknown>> {
  return (await prisma.profile.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;
}

describe('the socket options of an xray profile', () => {
  it('are stored as sent and not invented when absent', async () => {
    const withThem = await create({ ...reality, ...set });
    expect(withThem.statusCode, withThem.body).toBe(201);
    expect(await stored(JSON.parse(withThem.body).id)).toMatchObject(set);

    const without = await create(reality);
    expect(without.statusCode, without.body).toBe(201);
    const config = await stored(JSON.parse(without.body).id);
    for (const key of Object.keys(set)) expect(config, key).not.toHaveProperty(key);
  });

  it('come back in the profile the API returns', async () => {
    const res = await create({ ...reality, ...set });
    const got = await app.inject({ method: 'GET', url: `/api/profiles/${JSON.parse(res.body).id}`, headers: auth() });
    expect(JSON.parse(got.body).config).toMatchObject(set);
  });

  it('survive an edit that does not send them, which is every save of the old form', async () => {
    const id = JSON.parse((await create({ ...reality, ...set })).body).id as string;
    const res = await edit(id, { config: reality });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(id)).toMatchObject(set);
  });

  it('change one at a time, and null clears one without storing it', async () => {
    const id = JSON.parse((await create({ ...reality, ...set })).body).id as string;
    const res = await edit(id, { config: { ...reality, tcpUserTimeout: 20000, tcpKeepAliveIdle: null } });
    expect(res.statusCode, res.body).toBe(200);
    const config = await stored(id);
    expect(config.tcpUserTimeout).toBe(20000);
    expect(config).not.toHaveProperty('tcpKeepAliveIdle');
    expect(config.tcpKeepAliveInterval).toBe(10);
  });

  it('take no null into a new profile', async () => {
    const res = await create({ ...reality, tcpUserTimeout: null });
    expect(res.statusCode, res.body).toBe(201);
    expect(await stored(JSON.parse(res.body).id)).not.toHaveProperty('tcpUserTimeout');
  });

  it('survive a change of transport, being no transport field', async () => {
    const id = JSON.parse((await create({ ...reality, ...set })).body).id as string;
    const res = await edit(id, { config: { ...reality, security: 'none', network: 'ws', path: '/w' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(id)).toMatchObject(set);
  });

  // The core logs a value the kernel refuses and comes up without it, so a value
  // out of range would be a save that does nothing.
  it.each([
    ['tcpUserTimeout', 0],
    ['tcpUserTimeout', -1],
    ['tcpUserTimeout', 2147483648],
    ['tcpUserTimeout', 1.5],
    ['tcpKeepAliveIdle', 0],
    ['tcpKeepAliveIdle', -1],
    ['tcpKeepAliveIdle', 32768],
    ['tcpKeepAliveInterval', 0],
    ['tcpKeepAliveInterval', -1],
    ['tcpKeepAliveInterval', 32768],
  ])('refuse %s = %s', async (key, value) => {
    const res = await create({ ...reality, [key]: value });
    expect(res.statusCode, res.body).toBe(400);
  });

  it.each([
    ['tcpUserTimeout', 1],
    ['tcpUserTimeout', 2147483647],
    ['tcpKeepAliveIdle', 32767],
    ['tcpKeepAliveInterval', 32767],
  ])('accept %s = %s, the edge of the range', async (key, value) => {
    const res = await create({ ...reality, [key]: value });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('are refused on the sing-box engine, whose adapter does not read them', async () => {
    const res = await create({ ...reality, tcpKeepAliveIdle: 30 }, 'singbox');
    expect(res.statusCode, res.body).toBe(400);
    const issue = (JSON.parse(res.body) as { issues: Array<{ path: unknown; params?: { code?: string } }> }).issues.find(
      (i) => i.params?.code === 'SINGBOX_XRAY_FAMILY',
    );
    expect(issue?.path).toEqual(['config', 'tcpKeepAliveIdle']);
  });

  it('keep a profile that holds them from moving to sing-box', async () => {
    const id = JSON.parse((await create({ ...reality, tcpUserTimeout: 15000 })).body).id as string;
    const res = await edit(id, { engine: 'singbox' });
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'SINGBOX_XRAY_FAMILY', path: ['config', 'tcpUserTimeout'] });
  });

  it('reach the push as stored, and a profile without them pushes none', async () => {
    const node = await prisma.node.create({
      data: {
        name: 'n1',
        address: 'n1.example.com',
        protocol: 'xray',
        status: 'online',
        heartbeatSecret: randomBytes(32),
        cores: { observedAt: new Date().toISOString(), cores: [{ name: 'xray', engine: 'xray' }] } as unknown as object,
      },
      select: { id: true },
    });
    const bind = async (config: Record<string, unknown>, port: number) => {
      const p = JSON.parse((await create(config)).body).id as string;
      const res = await app.inject({
        method: 'POST',
        url: '/api/bindings',
        headers: auth(),
        payload: { profileId: p, nodeId: node.id, port },
      });
      expect(res.statusCode, res.body).toBe(201);
      return JSON.parse(res.body).id as string;
    };
    const withThem = await bind({ ...reality, ...set }, 8443);
    const without = await bind(reality, 8444);

    const req = await applyInboundsRequestForNode(node.id);
    const byId = new Map(req!.inbounds.map((i) => [i.id, i.config as unknown as Record<string, unknown>]));
    expect(byId.get(withThem)).toMatchObject(set);
    for (const key of Object.keys(set)) expect(byId.get(without), key).not.toHaveProperty(key);
  });

  // The upgrade: a node whose profiles set nothing is drawn as before, so the
  // drawing check (render-drift.ts) queues no push and no core restarts.
  it('leave the drawing and its fingerprint as they were when empty', async () => {
    const node = await prisma.node.create({
      data: {
        name: 'n2',
        address: 'n2.example.com',
        protocol: 'xray',
        status: 'online',
        heartbeatSecret: randomBytes(32),
        cores: { observedAt: new Date().toISOString(), cores: [{ name: 'xray', engine: 'xray' }] } as unknown as object,
      },
      select: { id: true },
    });
    const id = JSON.parse((await create(reality)).body).id as string;
    const bound = await app.inject({
      method: 'POST',
      url: '/api/bindings',
      headers: auth(),
      payload: { profileId: id, nodeId: node.id, port: 8445 },
    });
    expect(bound.statusCode, bound.body).toBe(201);
    const drawing = async () => {
      const req = await applyInboundsRequestForNode(node.id);
      return { json: canonicalJson(req), sha: requestFingerprint(req!) };
    };
    const first = await drawing();
    expect(first.json).not.toContain('tcpUserTimeout');
    expect(first.json).not.toContain('tcpKeepAlive');

    // The old form's save, a save with nulls, and set-then-cleared.
    expect((await edit(id, { config: reality })).statusCode).toBe(200);
    expect((await drawing()).sha).toBe(first.sha);
    const nulls = { tcpUserTimeout: null, tcpKeepAliveIdle: null, tcpKeepAliveInterval: null };
    expect((await edit(id, { config: { ...reality, ...nulls } })).statusCode).toBe(200);
    expect((await drawing()).sha).toBe(first.sha);
    expect((await edit(id, { config: { ...reality, ...set } })).statusCode).toBe(200);
    expect((await drawing()).sha).not.toBe(first.sha);
    expect((await edit(id, { config: { ...reality, ...nulls } })).statusCode).toBe(200);
    expect((await drawing()).sha).toBe(first.sha);
  });
});
