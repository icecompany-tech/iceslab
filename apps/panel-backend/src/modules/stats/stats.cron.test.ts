import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GetStatsResponse } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeTransport } from '../nodes/nodes.transport.js';
import { pollNodeStats } from './stats.cron.js';

// B3 integration: exercises the bulk `unnest` upsert SQL against a real
// Postgres (the part pure-logic tests can't cover). Needs the test DB stack
// (CI service containers, or the local dev compose). Run:
//   pnpm exec vitest run src/modules/stats/stats.cron.test.ts
//
// Note: createUser eagerly seeds an empty user_traffic row (users.service
// `traffic: { create: {} }`), so every poll hits the ON CONFLICT update path -
// used/lifetime increment from 0, online_at/last_connected_node_id refresh,
// first_connected_at is left as-is (update never sets it). Assertions below
// reflect that actual behaviour, which matches the pre-B3 upsert exactly.

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
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

async function createNode(name: string, address: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/nodes', headers: auth(), payload: { name, address } });
  if (res.statusCode !== 201) throw new Error(`createNode failed: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).id as string;
}

async function createUser(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/users', headers: auth(), payload: { username } });
  if (res.statusCode !== 201) throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).id as string;
}

function stats(users: { userId: string; bytesIn: number; bytesOut: number }[]): GetStatsResponse {
  return { users, uptime: 1, totalBytesIn: 0, totalBytesOut: 0 };
}

function mockStats(value: GetStatsResponse) {
  return vi.spyOn(NodeTransport.prototype, 'getStats').mockResolvedValue(value);
}

describe('pollNodeStats bulk upsert (B3, integration)', () => {
  it('increments user_traffic across two polls (ON CONFLICT) and leaves absent users alone', async () => {
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');
    const u1 = await createUser('alice');
    const u2 = await createUser('bob');

    mockStats(stats([
      { userId: u1, bytesIn: 100, bytesOut: 50 },
      { userId: u2, bytesIn: 10, bytesOut: 0 },
    ]));
    const r1 = await pollNodeStats();
    expect(r1.failed).toBe(0);
    expect(r1.ok).toBe(1);

    const t1a = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    const t1b = await prisma.userTraffic.findUnique({ where: { userId: u2 } });
    expect(t1a?.usedTrafficBytes).toBe(150n);
    expect(t1a?.lifetimeTrafficBytes).toBe(150n);
    expect(t1a?.lastConnectedNodeId).toBe(nodeId);
    expect(t1a?.onlineAt).not.toBeNull(); // update path refreshes online_at
    expect(t1b?.usedTrafficBytes).toBe(10n);

    // Second poll: u1 moves more bytes -> increment (not overwrite); u2 absent
    // from the payload -> untouched.
    vi.restoreAllMocks();
    mockStats(stats([{ userId: u1, bytesIn: 1, bytesOut: 1 }]));
    await pollNodeStats();

    const t2a = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    const t2b = await prisma.userTraffic.findUnique({ where: { userId: u2 } });
    expect(t2a?.usedTrafficBytes).toBe(152n); // 150 + 2
    expect(t2b?.usedTrafficBytes).toBe(10n); // unchanged
  });

  it('writes and increments per-user daily history and node hourly usage', async () => {
    const nodeId = await createNode('eu-2', '10.0.0.2:8443');
    const u1 = await createUser('carol');

    mockStats(stats([{ userId: u1, bytesIn: 200, bytesOut: 300 }]));
    await pollNodeStats();

    const hist = await prisma.nodeUserUsageHistory.findMany({ where: { userId: u1 } });
    expect(hist).toHaveLength(1);
    expect(hist[0]!.bytesIn).toBe(200n);
    expect(hist[0]!.bytesOut).toBe(300n);
    expect(hist[0]!.nodeId).toBe(nodeId);

    const usage = await prisma.nodeUsageHistory.findMany({ where: { nodeId } });
    expect(usage).toHaveLength(1);
    expect(usage[0]!.uploadBytes).toBe(200n); // raw bytes in
    expect(usage[0]!.downloadBytes).toBe(300n); // raw bytes out

    // Second poll same UTC day -> daily bucket increments via ON CONFLICT, no new row.
    vi.restoreAllMocks();
    mockStats(stats([{ userId: u1, bytesIn: 5, bytesOut: 5 }]));
    await pollNodeStats();
    const hist2 = await prisma.nodeUserUsageHistory.findMany({ where: { userId: u1 } });
    expect(hist2).toHaveLength(1);
    expect(hist2[0]!.bytesIn).toBe(205n);
    expect(hist2[0]!.bytesOut).toBe(305n);
  });

  it('scales per-user billing by the node multiplier; node usage stays raw', async () => {
    const nodeId = await createNode('eu-3', '10.0.0.3:8443');
    await prisma.node.update({ where: { id: nodeId }, data: { consumptionMultiplier: 2 } });
    const u1 = await createUser('dave');

    mockStats(stats([{ userId: u1, bytesIn: 100, bytesOut: 0 }]));
    await pollNodeStats();

    const t = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    expect(t?.usedTrafficBytes).toBe(200n); // scaled x2

    const usage = await prisma.nodeUsageHistory.findMany({ where: { nodeId } });
    expect(usage[0]!.uploadBytes).toBe(100n); // raw, unscaled
  });

  it('leaves a zero-delta user untouched (no billing, no online flip)', async () => {
    await createNode('eu-4', '10.0.0.4:8443');
    const u1 = await createUser('erin');

    // user-create seeded an empty traffic row; the poll must not move it.
    const before = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    expect(before?.usedTrafficBytes).toBe(0n);
    expect(before?.onlineAt).toBeNull();

    mockStats(stats([{ userId: u1, bytesIn: 0, bytesOut: 0 }]));
    await pollNodeStats();

    const after = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    expect(after?.usedTrafficBytes).toBe(0n); // unchanged
    expect(after?.onlineAt).toBeNull(); // non-presence zero-delta -> not touched
    const hist = await prisma.nodeUserUsageHistory.findMany({ where: { userId: u1 } });
    expect(hist).toHaveLength(0);
  });

  // Regression for the prod failure (2026-06-12): a node reported the same user
  // twice in one poll (two inbounds) and the bulk unnest upsert hit Postgres
  // 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  it('handles a user reported twice in one poll without a conflict error', async () => {
    const nodeId = await createNode('eu-5', '10.0.0.5:8443');
    const u1 = await createUser('frank');

    mockStats(stats([
      { userId: u1, bytesIn: 100, bytesOut: 50 },
      { userId: u1, bytesIn: 20, bytesOut: 5 }, // same user, second inbound
    ]));
    const r = await pollNodeStats();
    expect(r.failed).toBe(0); // previously failed with 21000
    expect(r.ok).toBe(1);

    const t = await prisma.userTraffic.findUnique({ where: { userId: u1 } });
    expect(t?.usedTrafficBytes).toBe(175n); // 150 + 25 aggregated

    const hist = await prisma.nodeUserUsageHistory.findMany({ where: { userId: u1 } });
    expect(hist).toHaveLength(1);
    expect(hist[0]!.bytesIn).toBe(120n);
    expect(hist[0]!.bytesOut).toBe(55n);
    expect(hist[0]!.nodeId).toBe(nodeId);
  });
});
