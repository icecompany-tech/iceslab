import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AddUserRequest, AddUsersRequest, ApplyInboundsRequest } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import {
  deriveAnytlsPassword,
  deriveShadowtlsPassword,
  deriveSsPassword,
  deriveTuicPassword,
  generateRealityKeyPair,
  generateWireguardKeyPair,
} from '../../lib/auth/credentials.js';
import { NodeRequestError, NodeTransport } from '../nodes/nodes.transport.js';
import { applyInboundsForNode, inboundSyncQueue } from '../inbounds/inbounds.queue.js';
import { nodeUsersQueue, syncAddUser } from './users.queue.js';
import { registerUserEventHandlers } from './users.events.js';

/**
 * A-053: credentials issued once at creation could not be issued again. After
 * POST /api/users/:id/reissue-credentials nothing the panel sends a node may
 * carry an old one, and the old link is refused.
 */
let app: FastifyInstance;
let token: string;

beforeAll(() => {
  // index.ts registers these at boot; buildApp does not.
  registerUserEventHandlers();
});

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  vi.spyOn(NodeTransport.prototype, 'listAssets').mockRejectedValue(new NodeRequestError('404', 404, null));
  vi.spyOn(inboundSyncQueue, 'add').mockResolvedValue({} as never);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

async function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}
async function create(url: string, payload: unknown) {
  const res = await call('POST', url, payload);
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string };
}

/** Everything a node is told: the inbounds, the roster of the push, single adds. */
function captureNodeTraffic(): unknown[] {
  const sent: unknown[] = [];
  vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockImplementation(async (req: ApplyInboundsRequest) => {
    sent.push(req);
    return { applied: req.inbounds.length, skipped: 0 } as never;
  });
  vi.spyOn(NodeTransport.prototype, 'addUsers').mockImplementation(async (req: AddUsersRequest) => {
    sent.push(req);
    return { results: req.users.map((u) => ({ userId: u.userId, ok: true })) };
  });
  vi.spyOn(NodeTransport.prototype, 'addUser').mockImplementation(async (req: AddUserRequest) => {
    sent.push(req);
  });
  vi.spyOn(NodeTransport.prototype, 'removeUser').mockResolvedValue(undefined as never);
  return sent;
}

/** A node with xray (vless and shadowsocks), hysteria and AmneziaWG on it,
 *  one user in the "All" squad. */
async function world(): Promise<{ nodeId: string; userId: string }> {
  const node = await prisma.node.create({
    data: {
      name: 'reissue-node',
      address: 'reissue.example.com',
      protocol: 'xray',
      status: 'online',
      heartbeatSecret: randomBytes(32),
      lastInboundSyncAt: new Date(),
      cores: {
        observedAt: new Date().toISOString(),
        cores: [
          { name: 'xray', engine: 'xray' },
          { name: 'hysteria', engine: 'hysteria' },
          { name: 'amneziawg', engine: 'amneziawg' },
        ],
      } as unknown as object,
    },
    select: { id: true },
  });
  const reality = generateRealityKeyPair();
  const vless = await create('/api/profiles', {
    name: 'r-vless',
    protocol: 'xray',
    config: {
      security: 'reality',
      network: 'raw',
      realityDest: 'www.cloudflare.com:443',
      realityServerNames: ['www.cloudflare.com'],
      realityShortIds: ['0123abcd'],
      realityPrivateKey: reality.privateKey,
      realityPublicKey: reality.publicKey,
    },
  });
  const hy2 = await create('/api/profiles', { name: 'r-hy2', protocol: 'hysteria', config: {} });
  const wg = generateWireguardKeyPair();
  const awg = await create('/api/profiles', {
    name: 'r-awg',
    protocol: 'amneziawg',
    config: { subnet: '10.66.66.0/24', serverPrivateKey: wg.privateKey, serverPublicKey: wg.publicKey, obfuscation: {} },
  });
  await create('/api/bindings', { profileId: vless.id, nodeId: node.id, port: 443 });
  await create('/api/bindings', { profileId: hy2.id, nodeId: node.id, port: 8443 });
  await create('/api/bindings', { profileId: awg.id, nodeId: node.id, port: 51820 });
  const user = await create('/api/users', { username: 'reissue_me' });
  return { nodeId: node.id, userId: user.id };
}

/** Every secret a client of this user signs in with, as the nodes see it. */
async function secretsOf(userId: string): Promise<string[]> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return [
    u.xrayUuid,
    u.hysteriaPassword,
    u.naivePassword,
    u.amneziawgPublicKey,
    u.amneziawgPrivateKey,
    deriveTuicPassword(u.xrayUuid),
    deriveAnytlsPassword(u.xrayUuid),
    deriveShadowtlsPassword(u.xrayUuid),
    deriveSsPassword(u.xrayUuid, '2022-blake3-aes-256-gcm'),
  ];
}

describe('POST /api/users/:id/reissue-credentials', () => {
  it('leaves no old credential in anything a node is sent, keeps the AmneziaWG address, and the old link is refused', async () => {
    const { nodeId, userId } = await world();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const old = await secretsOf(userId);

    // The world reaches the node: what it is told carries the user as they are.
    let sent = captureNodeTraffic();
    await applyInboundsForNode(nodeId);
    await syncAddUser(userId);
    const sentBefore = JSON.stringify(sent);
    for (const s of old.slice(0, 4)) expect(sentBefore, 'a credential the node holds today').toContain(s);
    const addressBefore = await prisma.amneziawgPeer.findMany({ where: { userId }, select: { profileId: true, ip: true } });
    expect(addressBefore.length).toBeGreaterThan(0);

    const res = await call('POST', `/api/users/${userId}/reissue-credentials`);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).subscriptionToken).not.toBe(before.subscriptionToken);

    const fresh = await secretsOf(userId);
    for (const [i, s] of old.entries()) expect(fresh[i], `credential ${i} changed`).not.toBe(s);

    vi.restoreAllMocks();
    vi.spyOn(NodeTransport.prototype, 'listAssets').mockRejectedValue(new NodeRequestError('404', 404, null));
    vi.spyOn(inboundSyncQueue, 'add').mockResolvedValue({} as never);
    sent = captureNodeTraffic();
    await applyInboundsForNode(nodeId);
    await syncAddUser(userId);
    const sentAfter = JSON.stringify(sent);
    for (const s of old) expect(sentAfter, 'an old credential').not.toContain(s);
    for (const s of fresh.slice(0, 4)) expect(sentAfter, 'the new credential').toContain(s);

    expect(await prisma.amneziawgPeer.findMany({ where: { userId }, select: { profileId: true, ip: true } })).toEqual(
      addressBefore,
    );

    const oldLink = await app.inject({ method: 'GET', url: `/sub/${before.subscriptionToken}` });
    expect(oldLink.statusCode).toBe(404);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const newLink = await app.inject({ method: 'GET', url: `/sub/${after.subscriptionToken}` });
    expect(newLink.statusCode).toBe(200);
  });

  it('rolls the user out to the nodes again through the edit event, and writes one audit row', async () => {
    const { userId } = await world();
    const add = vi.spyOn(nodeUsersQueue, 'add').mockResolvedValue({} as never);

    const res = await call('POST', `/api/users/${userId}/reissue-credentials`);
    expect(res.statusCode, res.body).toBe(200);

    await vi.waitFor(() => expect(add).toHaveBeenCalledWith('addUser', { userId }));
    const rows = await prisma.adminAuditEvent.findMany({ where: { action: 'user.credentials.reissue' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetKind: 'user', targetId: userId, outcome: 'ok', detail: null });
  });

  it('clears a revoke, as rotate does: the new link is the working one', async () => {
    const { userId } = await world();
    expect((await call('POST', `/api/users/${userId}/revoke`)).statusCode).toBe(200);
    const res = await call('POST', `/api/users/${userId}/reissue-credentials`);
    expect(JSON.parse(res.body).subRevokedAt).toBeNull();
  });

  it('answers 404 for a user who is not there, and writes no audit row', async () => {
    const res = await call('POST', '/api/users/00000000-0000-4000-8000-000000000000/reissue-credentials');
    expect(res.statusCode).toBe(404);
    expect(await prisma.adminAuditEvent.count({ where: { action: 'user.credentials.reissue' } })).toBe(0);
  });
});
