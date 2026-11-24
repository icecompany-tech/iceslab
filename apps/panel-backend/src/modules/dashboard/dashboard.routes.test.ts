import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { enforceScopes } from '../auth/scope.hook.js';
import { NodeTransport } from '../nodes/nodes.transport.js';
import { pollNodeStats } from '../stats/stats.cron.js';
import { observedMinute, observeNodePoll, pruneNodeMinuteTraffic } from '../stats/minute-traffic.js';
import type { getTrafficSeries, TrafficSeriesPeriod } from './traffic-series.service.js';
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
      name: 'Synthetic overview route test', scopes: ['dashboard:read'],
      tokenHash: createHash('sha256').update(token).digest('hex'),
      lastUsedAt: new Date(NOW),
    },
  });
  tokenId = apiToken.id;
  await prisma.node.create({
    data: { id: nodeId, name: nodeId, address: `${nodeId}.example.test`, heartbeatSecret: randomBytes(32) },
  });
  app.addHook('preHandler', enforceScopes);
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
    prisma.nodeMinuteTraffic.deleteMany({ where: { nodeId } }),
    prisma.nodeStatsPollCursor.deleteMany({ where: { nodeId } }),
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


describe('GET /api/dashboard/overview recorded UTC hours', () => {
  const HOUR_MS = 60 * 60 * 1000;
  // With TZ=America/New_York, the slots span the repeated local hour.
  const HOUR = Date.parse('2026-11-01T07:00:00Z');
  const hourAt = (offset: number) => new Date(HOUR + offset * HOUR_MS);
  const isoAt = (offset: number) => hourAt(offset).toISOString();

  async function storeHours(entries: [offset: number, download: bigint, upload: bigint][]) {
    await prisma.nodeUsageHistory.createMany({
      data: entries.map(([offset, downloadBytes, uploadBytes]) => ({
        nodeId,
        hour: hourAt(offset),
        downloadBytes,
        uploadBytes,
      })),
    });
  }

  it('pairs completed slots independently, preserves zero, and keeps the legacy cutoff', async () => {
    await storeHours([
      [-49, 100n, 0n], [-48, 4n, 1n], [-47, 0n, 0n], [-25, 2n, 0n],
      [-24, 6n, 1n], [-22, 0n, 0n], [-1, 7n, 1n], [0, 10n, 1n],
    ]);
    vi.setSystemTime(new Date(HOUR + 37 * 60 * 1000));
    const traffic = await overview();

    expect(traffic.recordedUtc24h).toEqual(Array.from({ length: 24 }, (_, index) => ({
      hour: isoAt(index - 24),
      bytes: ({ 0: 7, 2: 0, 23: 8 } as Record<number, number>)[index] ?? null,
      previousBytes: ({ 0: 5, 1: 0, 23: 2 } as Record<number, number>)[index] ?? null,
    })));
    expect(traffic.last24hHourly).toEqual([
      { hour: isoAt(-22), bytes: 0 },
      { hour: isoAt(-1), bytes: 8 },
      { hour: isoAt(0), bytes: 11 },
    ]);
  });

  it('returns a previous-only row even if legacy traffic is empty', async () => {
    await storeHours([[-48, 0n, 0n]]);
    vi.setSystemTime(hourAt(0));
    const traffic = await overview();

    expect(traffic.last24hHourly).toEqual([]);
    expect(traffic.recordedUtc24h).toHaveLength(24);
    expect(traffic.recordedUtc24h?.[0]).toEqual({ hour: isoAt(-24), bytes: null, previousBytes: 0 });
  });

  it('omits the new array if no completed slot has a record', async () => {
    await storeHours([[-49, 90n, 0n], [0, 5n, 0n]]);
    vi.setSystemTime(hourAt(0));
    const traffic = await overview();

    expect(traffic).not.toHaveProperty('recordedUtc24h');
    expect(traffic.last24hHourly).toEqual([{ hour: isoAt(0), bytes: 5 }]);
  });

  it('expires the cached snapshot at the hour and shifts both windows together', async () => {
    await storeHours([[-49, 3n, 0n], [-48, 4n, 0n], [-24, 6n, 0n], [0, 11n, 0n]]);
    vi.setSystemTime(new Date(HOUR - 2000));
    const before = await overview();
    expect(before.recordedUtc24h?.[0]).toEqual({ hour: isoAt(-25), bytes: null, previousBytes: 3 });
    expect(before.recordedUtc24h?.at(-1)?.hour).toBe(isoAt(-2));
    expect(redis.set).toHaveBeenLastCalledWith('dashboard:overview:v1', expect.any(String), 'PXAT', HOUR);

    vi.setSystemTime(hourAt(0));
    const after = await overview();
    expect(after.recordedUtc24h?.[0]).toEqual({ hour: isoAt(-24), bytes: 6, previousBytes: 4 });
    expect(after.recordedUtc24h?.at(-1)).toEqual({ hour: isoAt(-1), bytes: null, previousBytes: null });
    expect(after.last24hHourly).toEqual([{ hour: isoAt(-24), bytes: 6 }, { hour: isoAt(0), bytes: 11 }]);
    expect(redis.set).toHaveBeenLastCalledWith('dashboard:overview:v1', expect.any(String), 'PXAT', HOUR + 30_000);
  });
});


describe('GET /api/dashboard/traffic-series', () => {
  const minutes = 60_000;
  const endpoint = '/api/dashboard/traffic-series';

  async function series(period: TrafficSeriesPeriod) {
    const response = await app.inject({
      method: 'GET', url: `${endpoint}?period=${period}`, headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response;
  }

  it('requires dashboard authentication and validates the period', async () => {
    expect((await app.inject(`${endpoint}?period=1h`)).statusCode).toBe(401);
    expect((await app.inject({
      url: `${endpoint}?period=30d`, headers: { authorization: `Bearer ${token}` },
    })).statusCode).toBe(400);
  });

  it('returns a fixed empty minute window before collection starts', async () => {
    const body = (await series('1h')).json<Awaited<ReturnType<typeof getTrafficSeries>>>();
    expect(body.period).toBe('1h');
    expect(body.canCompareTotals).toBe(false);
    expect(body.points).toHaveLength(60);
    expect(body.points[0]).toEqual({ at: '2026-11-24T12:37:00.000Z', bytes: null, previousBytes: null });
    expect(body.points.at(-1)).toEqual({ at: '2026-11-24T13:36:00.000Z', bytes: null, previousBytes: null });
  });

  it.each([['1h', 60], ['7d', 7], ['90d', 90]] as const)('pairs independent rows for %s at UTC boundaries', async (period, size) => {
    const step = period === '1h' ? minutes : DAY_MS;
    const end = Math.floor(Date.parse(NOW) / step) * step;
    const position = (offset: number) => new Date(end + offset * step);
    const samples = [[-2 * size - 1, 500], [-2 * size, 7], [-2 * size + 1, 0],
      [-size - 1, 3], [-size, 11], [-size + 2, 17], [-1, 23], [0, 600]] as const;
    if (period === '1h') {
      await prisma.nodeMinuteTraffic.createMany({
        data: samples.map(([offset, value]) => ({ nodeId, minute: position(offset), bytes: BigInt(value) })),
      });
    } else {
      await prisma.nodeUsageHistory.createMany({
        data: samples.map(([offset, value]) => ({
          nodeId, hour: new Date(position(offset).getTime() + 13 * 60 * minutes), uploadBytes: BigInt(value),
        })),
      });
    }

    const response = await series(period);
    const body = response.json<Awaited<ReturnType<typeof getTrafficSeries>>>();
    expect(body).toEqual({
      period,
      points: Array.from({ length: size }, (_, index) => ({
        at: position(index - size).toISOString(),
        bytes: new Map([[0, 11], [2, 17], [size - 1, 23]]).get(index) ?? null,
        previousBytes: new Map([[0, 7], [1, 0], [size - 1, 3]]).get(index) ?? null,
      })),
      canCompareTotals: false,
    });
  });

  it('allows day total comparison only with matching complete hourly coverage', async () => {
    const count = 14 * 24;
    const hours = Array.from({ length: count }, (_, index) => ({
      nodeId, hour: new Date(TODAY - (count - index) * 60 * minutes), downloadBytes: 1n,
    }));
    await prisma.nodeUsageHistory.createMany({ data: hours });
    const complete = (await series('7d')).json<Awaited<ReturnType<typeof getTrafficSeries>>>();
    expect(complete.canCompareTotals).toBe(true);
    expect(complete.points.every((point) => point.bytes === 24 && point.previousBytes === 24)).toBe(true);

    await prisma.nodeUsageHistory.delete({ where: { nodeId_hour: { nodeId, hour: hours[0]!.hour } } });
    const incomplete = (await series('7d')).json<Awaited<ReturnType<typeof getTrafficSeries>>>();
    expect(incomplete.canCompareTotals).toBe(false);
    expect(incomplete.points[0]?.previousBytes).toBe(23);
  });

  it('writes short observed deltas once and keeps gaps, quota and hourly accounting independent', async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: {
      id: userId, xrayUuid: userId, shortId: userId.slice(0, 8), username: userId,
      subscriptionToken: userId, hysteriaPassword: 'test', naivePassword: 'test',
      amneziawgPrivateKey: 'test', amneziawgPublicKey: 'test',
    } });
    const nodeTime = Date.parse('2026-11-24T23:59:45Z');
    const stats = vi.spyOn(NodeTransport.prototype, 'getStats');
    function setPoll(offset: number, bytes: number, noData = false, coreBytes = bytes) {
      const scheduledAt = new Date(nodeTime + offset * 1000);
      vi.setSystemTime(scheduledAt);
      stats.mockResolvedValue({
        cumulative: true,
        users: noData ? [] : [{ userId, bytesIn: bytes, bytesOut: 0, cumulative: true, protocol: 'xray', engine: 'xray' }],
        cores: [{ protocol: 'xray', engine: 'xray', bytesIn: coreBytes, bytesOut: 0, cumulative: true, noData }],
        uptime: 1000 + offset, totalBytesIn: bytes, totalBytesOut: 0,
      });
      return scheduledAt;
    }

    try {
      expect((await pollNodeStats(setPoll(0, 100))).ok).toBe(1);
      expect(await prisma.nodeMinuteTraffic.count({ where: { nodeId } })).toBe(0);
      const repeated = setPoll(30, 130);
      await Promise.all([pollNodeStats(repeated), pollNodeStats(repeated)]);
      expect(stats).toHaveBeenCalledTimes(2);
      expect((await pollNodeStats(repeated)).ok).toBe(0);
      expect(stats).toHaveBeenCalledTimes(2);
      await pollNodeStats(setPoll(60, 135));
      await pollNodeStats(setPoll(90, 135)); // an observed zero in the next minute
      await pollNodeStats(setPoll(270, 160)); // a gap, but the hourly total and quota still advance
      await pollNodeStats(setPoll(300, 1)); // reset
      await pollNodeStats(setPoll(330, 1, true));
      await pollNodeStats(setPoll(360, 4)); // first observation after no data
      // Simulate another worker owning the persisted observation.
      await prisma.nodeStatsPollCursor.update({ where: { nodeId }, data: { observationId: randomUUID() } });
      await pollNodeStats(setPoll(390, 9));
      await pollNodeStats(setPoll(420, 9, false, 0)); // inbound source falls back, user counter remains stable
      await pollNodeStats(setPoll(450, 14)); // inbound recovers without a spike in the minute series
      const legacySlot = new Date(nodeTime + 480 * 1000);
      vi.setSystemTime(legacySlot);
      stats.mockResolvedValue({
        users: [{ userId, bytesIn: 4, bytesOut: 1 }], uptime: 1480, totalBytesIn: 0, totalBytesOut: 0,
      });
      expect(await pollNodeStats(legacySlot)).toEqual({ ok: 1, failed: 0 });
      expect(await pollNodeStats(legacySlot)).toEqual({ ok: 0, failed: 0 });

      const recorded = await prisma.nodeMinuteTraffic.findMany({ where: { nodeId }, orderBy: { minute: 'asc' } });
      expect(recorded.map(({ minute, bytes }) => [minute.toISOString(), bytes])).toEqual([
        ['2026-11-25T00:00:00.000Z', 35n],
        ['2026-11-25T00:01:00.000Z', 0n],
        ['2026-11-25T00:06:00.000Z', 0n],
        ['2026-11-25T00:07:00.000Z', 5n],
      ]);
      const usage = await prisma.nodeUsageHistory.aggregate({ where: { nodeId }, _sum: { uploadBytes: true } });
      expect(usage._sum.uploadBytes).toBe(81n);
      const quota = await prisma.userTraffic.findUnique({ where: { userId } });
      expect(quota?.usedTrafficBytes).toBe(78n);
      expect(quota?.lifetimeTrafficBytes).toBe(78n);
      const minuteSeries = (await series('1h')).json<Awaited<ReturnType<typeof getTrafficSeries>>>();
      expect(minuteSeries.points.filter(({ bytes }) => bytes !== null).map(({ bytes }) => bytes)).toEqual([35, 0, 0]);
      expect(await pruneNodeMinuteTraffic(Date.parse('2026-11-26T00:01:00Z'))).toBe(1);
      expect(await prisma.nodeMinuteTraffic.count({ where: { nodeId } })).toBe(3);
    } finally {
      stats.mockRestore();
      await prisma.nodeUserTrafficSnapshot.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });
  it('releases a failed node claim and resumes after a stale claim expires', async () => {
    const stats = vi.spyOn(NodeTransport.prototype, 'getStats');
    const slot = new Date(NOW);
    try {
      let visibleLease = false;
      stats.mockImplementationOnce(async () => {
        const inFlight = await prisma.nodeStatsPollCursor.findUnique({ where: { nodeId } });
        visibleLease = Boolean(inFlight?.leaseToken);
        throw new Error('synthetic node unavailable');
      });
      expect(await pollNodeStats(slot)).toEqual({ ok: 0, failed: 1 });
      expect(visibleLease).toBe(true);
      const cursor = await prisma.nodeStatsPollCursor.findUnique({ where: { nodeId } });
      expect(cursor).toMatchObject({ leaseToken: null, observationId: null, scheduledAt: null });
      expect(await prisma.nodeMinuteTraffic.count({ where: { nodeId } })).toBe(0);

      await prisma.nodeStatsPollCursor.update({
        where: { nodeId },
        data: { leaseToken: randomUUID(), leaseUntil: new Date('2099-01-01T00:00:00Z') },
      });
      expect(await pollNodeStats(slot)).toEqual({ ok: 0, failed: 0 });
      expect(stats).toHaveBeenCalledTimes(1);

      await prisma.nodeStatsPollCursor.update({
        where: { nodeId }, data: { leaseUntil: new Date('2000-01-01T00:00:00Z') },
      });
      stats.mockResolvedValue({
        users: [], totalBytesIn: 0, totalBytesOut: 0, uptime: 1,
        cores: [{ engine: 'naive', protocol: 'naive', cumulative: false, bytesIn: 0, bytesOut: 0 }],
      });
      expect(await pollNodeStats(slot)).toEqual({ ok: 1, failed: 0 });
      expect(stats).toHaveBeenCalledTimes(2);
      expect(await prisma.nodeMinuteTraffic.count({ where: { nodeId } })).toBe(0);
      expect((await prisma.nodeStatsPollCursor.findUnique({ where: { nodeId } }))?.leaseToken).toBeNull();
    } finally {
      stats.mockRestore();
    }
  });
  it('separates Xray and sing-box with the same protocol and ignores unmarked users', () => {
    const started = Date.parse(NOW);
    function observe(offset: number, xray: number, singbox: number, singboxAvailable = true, xrayAvailable = true) {
      const at = started + offset * 1000;
      return observeNodePoll(randomUUID(), {
        users: [
          { userId: nodeId, protocol: 'xray', engine: 'xray', cumulative: true, bytesIn: xray, bytesOut: 0 },
          { userId: nodeId, protocol: 'xray', engine: 'singbox', cumulative: true, bytesIn: singbox, bytesOut: 0 },
          { userId: tokenId, protocol: 'xray', engine: 'singbox', bytesIn: singbox, bytesOut: 0 },
        ],
        cores: [
          { protocol: 'xray', engine: 'xray', cumulative: true, noData: !xrayAvailable, bytesIn: xray, bytesOut: 0 },
          { protocol: 'xray', engine: 'singbox', cumulative: true, noData: !singboxAvailable, bytesIn: singbox, bytesOut: 0 },
        ],
        uptime: 1000 + offset, totalBytesIn: 0, totalBytesOut: 0,
      }, at, at);
    }
    const baseline = observe(0, 100, 1000);
    const both = observe(30, 110, 1030);
    expect(observedMinute(baseline, both)?.bytes).toBe(40n);
    const onlyXray = observe(60, 110, 2000, false);
    expect(observedMinute(both, onlyXray)?.bytes).toBe(0n);
    expect(observedMinute(onlyXray, observe(90, 110, 3000, false, false))).toBeUndefined();
  });
});
