import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/infra/redis.js';
import type { DashboardOverview } from './dashboard.service.js';
import { dashboardRoutes } from './dashboard.routes.js';

vi.mock('../../lib/infra/redis.js', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') },
}));
vi.mock('../nodes/nodes.cron.js', () => ({
  readCachedNodeMetrics: vi.fn().mockResolvedValue(null),
}));

const NOW = '2026-11-24T13:37:00Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = Date.parse('2026-11-24T00:00:00Z');

const app = Fastify();
const token = `icp_${randomUUID()}`;
const nodeId = randomUUID();
let tokenId: string;

function dateAt(offset: number): Date {
  return new Date(TODAY + offset * DAY_MS);
}

async function storeDays(first: number, last: number, directions: boolean, zero = false) {
  await prisma.dashboardClientTrafficDay.createMany({
    data: Array.from({ length: last - first + 1 }, (_, i) => {
      const offset = first + i;
      const unit = zero ? 0n : BigInt(offset + 62);
      return {
        date: dateAt(offset),
        totalBytes: 3n * unit,
        toUsersBytes: directions ? 2n * unit : null,
        fromUsersBytes: directions ? unit : null,
      };
    }),
  });
}

async function overview(): Promise<DashboardOverview['traffic']> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/dashboard/overview',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<DashboardOverview>().traffic;
}

beforeAll(async () => {
  const apiToken = await prisma.apiToken.create({
    data: {
      name: 'Synthetic overview route test',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      lastUsedAt: new Date(NOW),
    },
  });
  tokenId = apiToken.id;
  await prisma.node.create({
    data: { id: nodeId, name: nodeId, address: `${nodeId}.example.test`, heartbeatSecret: randomBytes(32) },
  });
  await app.register(dashboardRoutes);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(redis.set).mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.$transaction([
    prisma.dashboardClientTrafficDay.deleteMany({ where: { date: { gte: dateAt(-61), lte: dateAt(0) } } }),
    prisma.nodeUsageHistory.deleteMany({ where: { nodeId } }),
  ]);
});

afterAll(async () => {
  await app.close();
  if (tokenId) await prisma.apiToken.deleteMany({ where: { id: tokenId } });
  await prisma.node.deleteMany({ where: { id: nodeId } });
  await prisma.$disconnect();
});

describe('GET /api/dashboard/overview completed UTC traffic', () => {
  it('aligns 30 days with the previous period and excludes adjacent UTC dates', async () => {
    await storeDays(-61, 0, true);
    const traffic = await overview();

    const expected = Array.from({ length: 30 }, (_, i) => ({
      date: dateAt(i - 30).toISOString().slice(0, 10),
      bytes: 3 * (i + 32),
      previousBytes: 3 * (i + 2),
    }));
    expect(traffic.completedUtc30d?.dailyComparison).toEqual(expected);
    const directions = traffic.completedUtc30d?.monthlyDirections;
    expect(directions).toEqual({ toUsers: 2790, fromUsers: 1395 });
    expect(expected.reduce((sum, day) => sum + day.bytes, 0)).toBe(directions!.toUsers + directions!.fromUsers);
    expect(expected.reduce((sum, day) => sum + day.previousBytes, 0)).toBe(1485);
  });

  it('keeps a measured zero in the comparison and direction totals', async () => {
    await storeDays(-60, -1, true, true);
    const traffic = await overview();

    const zeroDays = Array.from({ length: 30 }, (_, i) => ({
      date: dateAt(i - 30).toISOString().slice(0, 10),
      bytes: 0,
      previousBytes: 0,
    }));
    expect(traffic.completedUtc30d).toEqual({
      dailyComparison: zeroDays,
      monthlyDirections: { toUsers: 0, fromUsers: 0 },
    });
  });

  it('returns directions with no comparison when a previous day is missing', async () => {
    await storeDays(-59, -1, true);
    expect((await overview()).completedUtc30d).toEqual({
      monthlyDirections: { toUsers: 2790, fromUsers: 1395 },
    });
  });

  it('returns a comparison when one current day has no direction data', async () => {
    await storeDays(-60, -2, true);
    await storeDays(-1, -1, false);
    const traffic = await overview();

    expect(traffic.completedUtc30d?.dailyComparison).toHaveLength(30);
    expect(traffic.completedUtc30d).not.toHaveProperty('monthlyDirections');
  });

  it('does not present sparse legacy rows as finalized data and preserves legacy period bounds', async () => {
    await storeDays(-60, -2, true);
    await prisma.nodeUsageHistory.createMany({
      data: [
        { hour: new Date('2026-09-25T13:00:00Z'), downloadBytes: 1000n },
        { hour: new Date('2026-09-25T14:00:00Z'), downloadBytes: 3n },
        { hour: dateAt(-30), downloadBytes: 7n },
        { hour: dateAt(-1), downloadBytes: 5n },
        { hour: dateAt(0), uploadBytes: 13n },
      ].map((row) => ({ nodeId, ...row })),
    });

    const traffic = await overview();
    expect(traffic).not.toHaveProperty('completedUtc30d');
    expect(traffic).not.toHaveProperty('dailyComparison');
    expect(traffic).not.toHaveProperty('monthlyDirections');
    expect(traffic.last30dBytes).toBe(25);
    expect(traffic.prev30dBytes).toBe(3);
    expect(traffic.todayBytes).toBe(13);
  });

  it('expires the cache at midnight and shifts both periods at midnight UTC', async () => {
    await storeDays(-61, 0, true);
    vi.setSystemTime(new Date('2026-11-23T23:59:58Z'));
    const before = await overview();
    expect(before.completedUtc30d?.dailyComparison?.at(-1)?.date).toBe('2026-11-22');
    expect(redis.set).toHaveBeenLastCalledWith('dashboard:overview:v1', expect.any(String), 'PXAT', TODAY);

    vi.setSystemTime(dateAt(0));
    const after = await overview();
    expect(after.completedUtc30d?.dailyComparison?.at(-1)?.date).toBe('2026-11-23');
    expect(redis.set).toHaveBeenLastCalledWith('dashboard:overview:v1', expect.any(String), 'PXAT', TODAY + 30_000);
  });
});
