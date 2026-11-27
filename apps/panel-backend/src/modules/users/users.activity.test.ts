import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { isOnlineAt } from '@iceslab/shared';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { prisma } from '../../prisma.js';
import { enforceScopes } from '../auth/scope.hook.js';
import { dashboardRoutes } from '../dashboard/dashboard.routes.js';
import { NodeTransport } from '../nodes/nodes.transport.js';
import { pollNodeStats } from '../stats/stats.cron.js';
import { usersRoutes } from './users.routes.js';

vi.mock('../../lib/infra/redis.js', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]), del: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'),
  },
}));
vi.mock('../nodes/nodes.cron.js', () => ({ readCachedNodeMetrics: vi.fn().mockResolvedValue(null) }));

const app = Fastify();
const token = `icp_${randomUUID()}`;
const headers = { authorization: `Bearer ${token}` };
type User = {
  id: string;
  firstConnectedAt: string | null;
  lastOnlineAt: string | null;
  lastConnectedNodeId: string | null;
};
type Registry = { total: number; users: User[] };

beforeAll(async () => {
  app.addHook('preHandler', enforceScopes);
  await app.register(usersRoutes);
  await app.register(dashboardRoutes);
});

beforeEach(async () => {
  await cleanDatabase();
  await prisma.apiToken.create({ data: {
    name: 'Synthetic user activity',
    tokenHash: createHash('sha256').update(token).digest('hex'),
    scopes: ['users:read', 'users:write', 'dashboard:read'], lastUsedAt: new Date(),
  } });
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanDatabase();
  await app.close();
  await prisma.$disconnect();
});

async function createUser(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/users', headers, payload: { username } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<User>();
}

function createNode(name: string, data: { id?: string; status?: string; consumptionMultiplierTenths?: number } = {}) {
  return prisma.node.create({
    data: { name, address: `${name}.example.test`, status: 'online', heartbeatSecret: randomBytes(32), ...data },
  });
}

async function registry(query = '') {
  const res = await app.inject({ url: `/api/users${query}`, headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Registry>();
}

async function onlineNow() {
  const res = await app.inject({ url: '/api/dashboard/overview', headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ users: { onlineNow: number } }>().users.onlineNow;
}

const response = (...ids: string[]) => ({
  users: ids.map((userId) => ({ userId, bytesIn: 9, bytesOut: 1 })),
  totalBytesIn: 0, totalBytesOut: 0, uptime: 1000,
});

it.each([
  ['older first', false, false],
  ['newer first', false, true],
  ['equal, A first', true, false],
  ['equal, B first', true, true],
] as const)('keeps the latest pair while charging both nodes (%s)', async (_label, equal, finishBFirst) => {
  const { id: user } = await createUser('synthetic-race');
  const a = await createNode('node-a', { id: '20000000-0000-4000-8000-000000000001' });
  const b = await createNode('node-b', { id: '10000000-0000-4000-8000-000000000001', status: 'disabled' });
  const startedA = Promise.withResolvers<void>();
  const startedB = Promise.withResolvers<void>();
  const answerA = Promise.withResolvers<ReturnType<typeof response>>();
  const answerB = Promise.withResolvers<ReturnType<typeof response>>();
  const stats = vi.spyOn(NodeTransport.prototype, 'getStats')
    .mockImplementationOnce(() => { startedA.resolve(); return answerA.promise; })
    .mockImplementationOnce(() => { startedB.resolve(); return answerB.promise; });

  const timeA = new Date('2026-11-27T10:00:29Z');
  const timeB = equal ? timeA : new Date('2026-11-27T10:00:30Z');
  vi.setSystemTime(timeA);
  const pollA = pollNodeStats(new Date('2026-11-27T10:00:00Z'));
  let pollB: ReturnType<typeof pollNodeStats> | undefined;
  try {
    await startedA.promise;
    await prisma.node.update({ where: { id: b.id }, data: { status: 'online' } });
    vi.setSystemTime(timeB);
    pollB = pollNodeStats(new Date('2026-11-27T10:00:30Z'));
    await startedB.promise;

    const firstAnswer = finishBFirst ? answerB : answerA;
    firstAnswer.resolve(response(user));
    expect(await (finishBFirst ? pollB : pollA)).toEqual({ ok: 1, failed: 0 });
    expect((await registry()).users[0]).toMatchObject({
      lastOnlineAt: (finishBFirst ? timeB : timeA).toISOString(),
      lastConnectedNodeId: (finishBFirst ? b : a).id,
    });
  } finally {
    answerA.resolve(response(user));
    answerB.resolve(response(user));
    await Promise.all([pollA, pollB]);
  }

  expect(stats).toHaveBeenCalledTimes(2);
  const row = (await registry()).users[0];
  expect(row).toMatchObject({
    lastOnlineAt: timeB.toISOString(),
    lastConnectedNodeId: b.id,
    firstConnectedAt: (finishBFirst ? timeB : timeA).toISOString(),
  });
  const traffic = await prisma.userTraffic.findUniqueOrThrow({ where: { userId: user } });
  expect(traffic).toMatchObject({ usedTrafficBytes: 20n, lifetimeTrafficBytes: 20n });
});

it('fills the first positive observation on a free node and keeps missing historical dates unknown', async () => {
  const created = await createUser('synthetic-new');
  expect(created).toMatchObject({ firstConnectedAt: null, lastOnlineAt: null, lastConnectedNodeId: null });
  const legacy = await createUser('synthetic-legacy');
  const legacyBytes = await createUser('synthetic-legacy-bytes');
  const legacyHistory = await createUser('synthetic-legacy-history');
  const node = await createNode('free-node', { consumptionMultiplierTenths: 0 });
  const start = Date.parse('2026-11-27T10:00:00Z');
  const firstActivity = new Date(start + 30_000);
  // The node FK can be missing even when the timestamp is already known.
  await prisma.userTraffic.update({
    where: { userId: legacy.id }, data: { onlineAt: firstActivity },
  });
  await prisma.userTraffic.update({
    where: { userId: legacyBytes.id }, data: { lifetimeTrafficBytes: 100n },
  });
  // A daily observation can survive even if the counters and timestamps are missing.
  await prisma.nodeUserUsageHistory.create({ data: {
    userId: legacyHistory.id, nodeId: node.id, date: new Date('2026-11-26T00:00:00Z'),
  } });

  const stats = vi.spyOn(NodeTransport.prototype, 'getStats');
  async function poll(offset: number, bytes: number) {
    const time = new Date(start + offset * 1000);
    vi.setSystemTime(time);
    stats.mockResolvedValue({
      users: [created, legacy, legacyBytes, legacyHistory].map(({ id }) => ({
        userId: id, protocol: 'xray', engine: 'xray', cumulative: true, bytesIn: bytes, bytesOut: 0,
      })),
      cores: [{ protocol: 'xray', engine: 'xray', cumulative: true, bytesIn: 4 * bytes, bytesOut: 0 }],
      totalBytesIn: 4 * bytes, totalBytesOut: 0, cumulative: true, uptime: 1000 + offset,
    });
    expect(await pollNodeStats(time)).toEqual({ ok: 1, failed: 0 });
  }
  const row = async (id: string) => (await registry()).users.find((user) => user.id === id);

  await poll(0, 100);
  expect(await row(created.id)).toMatchObject({ firstConnectedAt: null, lastOnlineAt: null });
  await poll(30, 110);
  expect(await row(created.id)).toMatchObject({
    firstConnectedAt: firstActivity.toISOString(), lastOnlineAt: firstActivity.toISOString(), lastConnectedNodeId: node.id,
  });
  expect(await row(legacy.id)).toMatchObject({
    firstConnectedAt: null, lastOnlineAt: firstActivity.toISOString(), lastConnectedNodeId: node.id,
  });
  await poll(60, 117);
  expect(await row(created.id)).toMatchObject({
    firstConnectedAt: firstActivity.toISOString(), lastOnlineAt: '2026-11-27T10:01:00.000Z',
  });
  expect(await row(legacy.id)).toMatchObject({ firstConnectedAt: null });
  expect(await row(legacyBytes.id)).toMatchObject({ firstConnectedAt: null });
  expect(await row(legacyHistory.id)).toMatchObject({ firstConnectedAt: null });
  expect(await prisma.userTraffic.findUniqueOrThrow({ where: { userId: created.id } }))
    .toMatchObject({ usedTrafficBytes: 0n, lifetimeTrafficBytes: 0n });
});

it('matches shared presence at the boundary while retaining the last observation after a failure', async () => {
  const { id: active } = await createUser('synthetic-active');
  const { id: disabled } = await createUser('synthetic-disabled');
  const { id: deleted } = await createUser('synthetic-deleted');
  const { id: unseen } = await createUser('synthetic-unseen');
  const node = await createNode('node-a');
  const stats = vi.spyOn(NodeTransport.prototype, 'getStats').mockResolvedValue(response(active, disabled, deleted));
  const observed = new Date('2026-11-27T11:00:00Z');
  vi.setSystemTime(observed);
  expect(await pollNodeStats(observed)).toEqual({ ok: 1, failed: 0 });
  await prisma.user.update({ where: { id: disabled }, data: { status: 'disabled' } });
  await prisma.user.update({ where: { id: deleted }, data: { deletedAt: observed } });

  const failed = new Date('2026-11-27T11:04:59.999Z');
  vi.setSystemTime(failed);
  stats.mockRejectedValueOnce(new Error('synthetic unreachable node'));
  expect(await pollNodeStats(failed)).toEqual({ ok: 0, failed: 1 });
  await prisma.node.update({ where: { id: node.id }, data: { status: 'unreachable' } });
  expect((await registry('?online=online&status=active')).total).toBe(1);
  expect((await registry('?online=online&limit=1')).total).toBe(2);

  for (const [age, online] of [[299_999, true], [300_000, false], [300_001, false]] as const) {
    vi.setSystemTime(observed.getTime() + age);
    expect(isOnlineAt(observed, Date.now())).toBe(online);
    expect((await registry('?online=online')).users.map(({ id }) => id)).toEqual(online ? [active, disabled] : []);
    expect((await registry('?online=offline')).users.map(({ id }) => id)).toEqual(online ? [] : [active, disabled]);
    expect((await registry('?online=never')).users.map(({ id }) => id)).toEqual([unseen]);
    expect(await onlineNow()).toBe(online ? 2 : 0);
  }
  expect((await registry()).users.find(({ id }) => id === active)).toMatchObject({
    lastOnlineAt: observed.toISOString(), lastConnectedNodeId: node.id,
  });
});
