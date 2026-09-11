import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * "Saved, but not applied yet" for a node.
 *
 * Until now only a cascade could tell a landed push from one in flight: the
 * comparison lived inside getCascadeStatus, so a node card had nothing to draw
 * the state from and a save looked identical whether it had reached the machine
 * or not.
 *
 * The hard half is not the comparison, it is what it compares AGAINST. A node
 * does not own its inbound set: editing a profile that six nodes share changes
 * the config of all six without touching one node row, so `node.updatedAt`
 * alone would call a pending push applied.
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

async function makeNode(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `sync-${seq}`, address: `sync-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function makeProfile(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: {
      name: `sync-profile-${seq}`,
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
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function bind(profileId: string, nodeId: string, port: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** The agent acknowledging a push, which is the only thing that stamps this. */
async function acknowledge(nodeId: string, when = new Date()): Promise<void> {
  await prisma.node.update({ where: { id: nodeId }, data: { lastInboundSyncAt: when } });
}

async function syncStatus(nodeId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/nodes/${nodeId}/sync-status`,
    headers: auth(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as {
    lastInboundSyncAt: string | null;
    configChangedAt: string;
    applied: boolean;
    online: boolean;
  };
}

describe('node sync status', () => {
  it('a node that has never taken a config is not applied', async () => {
    const nodeId = await makeNode();
    const s = await syncStatus(nodeId);
    expect(s.lastInboundSyncAt).toBeNull();
    expect(s.applied).toBe(false);
  });

  it('becomes applied once the agent acknowledges a push after the change', async () => {
    const nodeId = await makeNode();
    await acknowledge(nodeId);
    const s = await syncStatus(nodeId);
    expect(s.applied).toBe(true);
    expect(new Date(s.lastInboundSyncAt!) > new Date(s.configChangedAt)).toBe(true);
  });

  it('goes back to pending when a BINDING changes after the acknowledgement', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile();
    const bindingId = await bind(profileId, nodeId, 443);
    await acknowledge(nodeId);
    expect((await syncStatus(nodeId)).applied).toBe(true);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${bindingId}`,
      headers: auth(),
      payload: { port: 8443 },
    });
    expect(res.statusCode, res.body).toBe(200);

    expect((await syncStatus(nodeId)).applied).toBe(false);
  });

  it('goes back to pending when the PROFILE changes, though no node row was touched', async () => {
    // The case node.updatedAt cannot see, and the reason this is not a boolean
    // on the list DTO: one profile edit changes the config of every node bound
    // to it.
    const nodeId = await makeNode();
    const profileId = await makeProfile();
    await bind(profileId, nodeId, 443);
    await acknowledge(nodeId);
    expect((await syncStatus(nodeId)).applied).toBe(true);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profileId}`,
      headers: auth(),
      payload: { description: 'edited' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const after = await syncStatus(nodeId);
    expect(after.applied).toBe(false);
    expect(new Date(after.configChangedAt) > new Date(after.lastInboundSyncAt!)).toBe(true);
  });

  it('a status poll does not make an applied node look pending', async () => {
    // The trap this file caught: the poller writes status / lastStatusMessage /
    // coreVersion to the node row every tick, and stamping the acknowledgement
    // writes to it too. Anchoring "config changed" on node.updatedAt therefore
    // made every node permanently pending, the healthy ones first.
    const nodeId = await makeNode();
    await acknowledge(nodeId);
    expect((await syncStatus(nodeId)).applied).toBe(true);

    await prisma.node.update({
      where: { id: nodeId },
      data: { status: 'degraded', lastStatusMessage: 'xray restarted', coreVersion: '26.3.27' },
    });

    expect((await syncStatus(nodeId)).applied).toBe(true);
  });

  it('carries online separately, because a pending push on a dead node is waiting, not stuck', async () => {
    const nodeId = await makeNode();
    await prisma.node.update({ where: { id: nodeId }, data: { status: 'online' } });
    expect((await syncStatus(nodeId)).online).toBe(true);
    await prisma.node.update({ where: { id: nodeId }, data: { status: 'unreachable' } });
    expect((await syncStatus(nodeId)).online).toBe(false);
  });

  it('the node DTO carries the raw acknowledgement stamp', async () => {
    const nodeId = await makeNode();
    const when = new Date();
    await acknowledge(nodeId, when);
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}`, headers: auth() });
    expect(JSON.parse(res.body).lastInboundSyncAt).toBe(when.toISOString());
  });

  it('404s for a node that does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes/00000000-0000-4000-8000-000000000000/sync-status',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
