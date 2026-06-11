import type { HostMetricsResponse } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/redis.js';
import { collectSystemMetrics, type SystemMetrics } from './system-metrics.js';
import { readCachedNodeMetrics } from '../nodes/nodes.cron.js';

// Dashboard overview is hit by every admin's browser every 10s. The aggregates
// (groupBy on NodeUsageHistory + UserTraffic counts) cost a few hundred ms
// each tick; cache the assembled DTO for 8s so 5 admins refreshing in unison
// pay only one round of SQL.
//
// TTL is deliberately >= the frontend poll cadence (DashboardPage 10s,
// AppLayout 30s). At 8s the cache expired before almost every poll, so the
// expensive ~20-query recompute (userMetrics + 7×traffic + nodes + protocols
// + topUsers + events + host sample) ran every ~10s and pegged 1-vCPU hosts
// to a visible burst. At 30s the recompute runs at most twice a minute no
// matter how many tabs poll; clients in between get warm cache. Staleness
// bound (30s) is fine for an operator dashboard — node status has its own
// 30s cron and traffic counters are cumulative.
const OVERVIEW_CACHE_KEY = 'dashboard:overview:v1';
const OVERVIEW_CACHE_TTL_SECONDS = 30;

const ONLINE_NOW_WINDOW_MS = 3 * 60 * 1000;
const TOP_USERS_LIMIT = 5;
const RECENT_EVENTS_LIMIT = 10;

export interface DashboardOverview {
  users: {
    total: number;
    byStatus: Record<string, number>;
    onlineNow: number;
    onlineToday: number;
    onlineThisWeek: number;
    neverOnline: number;
  };
  traffic: {
    todayBytes: number;
    yesterdayBytes: number;
    last7dBytes: number;
    last30dBytes: number;
    calendarMonthBytes: number;
    currentYearBytes: number;
    // K1 — prior-period totals so the UI can render "vs previous" deltas
    // (today vs yesterday already covered by yesterdayBytes). Rolling windows
    // mirror their current-period counterparts; calendar month/year use
    // calendar boundaries.
    prev7dBytes: number;
    prev30dBytes: number;
    lastCalendarMonthBytes: number;
    lastYearBytes: number;
    last24hHourly: { hour: string; bytes: number }[];
  };
  system: {
    onlineNodeCount: number;
    totalNodeCount: number;
  };
  // Wave-14 #18: sidebar inventory counts so AppLayout doesn't fire 4 separate
  // count queries (listUsers/listProfiles/listSquads/listNodes — each pulling
  // full row payloads only to read .length on the client) on every page load.
  // Computed cheap (4 × `prisma.X.count`) and ride the same Redis cache the
  // rest of the overview does.
  inventory: {
    profileCount: number;
    squadCount: number;
  };
  host: SystemMetrics;
  nodes: {
    id: string;
    name: string;
    address: string;
    protocol: string;
    status: string;
    countryCode: string | null;
    lastStatusChange: string | null;
    inboundCount: number;
    todayBytes: number;
    /** Latest /metrics snapshot pulled from this node, or null if cache cold
     *  / TTL'd / node unreachable. Cache TTL is 60s, poll cadence is 15s. */
    metrics: HostMetricsResponse | null;
  }[];
  byProtocol: {
    protocol: string;
    inboundCount: number;
    enabledUserCount: number;
  }[];
  topUsersToday: {
    id: string;
    username: string;
    bytes: number;
  }[];
  recentEvents: {
    id: string;
    eventType: string;
    userId: string;
    username: string | null;
    createdAt: string;
  }[];
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfYesterday(): Date {
  const d = startOfToday();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function startOfWeek(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

function startOfMonth(): Date {
  const d = startOfToday();
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}

function startOfCalendarMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// K1 — prior-period boundaries for "vs previous" deltas.
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function startOfLastCalendarMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}

function startOfLastYear(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1));
}

function startOfYear(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

async function sumNodeUsageSince(since: Date, until?: Date): Promise<number> {
  const where: { hour: { gte: Date; lt?: Date } } = { hour: { gte: since } };
  if (until) where.hour.lt = until;
  const agg = await prisma.nodeUsageHistory.aggregate({
    where,
    _sum: { downloadBytes: true, uploadBytes: true },
  });
  const dl = agg._sum.downloadBytes ? Number(agg._sum.downloadBytes) : 0;
  const ul = agg._sum.uploadBytes ? Number(agg._sum.uploadBytes) : 0;
  return dl + ul;
}

async function last24hHourly(): Promise<{ hour: string; bytes: number }[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.nodeUsageHistory.groupBy({
    by: ['hour'],
    where: { hour: { gte: since } },
    _sum: { downloadBytes: true, uploadBytes: true },
    orderBy: { hour: 'asc' },
  });
  return rows.map((r) => ({
    hour: r.hour.toISOString(),
    bytes:
      (r._sum.downloadBytes ? Number(r._sum.downloadBytes) : 0) +
      (r._sum.uploadBytes ? Number(r._sum.uploadBytes) : 0),
  }));
}

async function userMetrics(): Promise<DashboardOverview['users']> {
  const now = new Date();
  const onlineCutoff = new Date(now.getTime() - ONLINE_NOW_WINDOW_MS);
  const todayCutoff = startOfToday();
  const weekCutoff = startOfWeek();

  const [statusGroups, onlineNow, onlineToday, onlineThisWeek, neverOnline, total] =
    await Promise.all([
      prisma.user.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: onlineCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: todayCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: weekCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: null },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
  }

  return {
    total,
    byStatus,
    onlineNow,
    onlineToday,
    onlineThisWeek,
    neverOnline,
  };
}

async function trafficMetrics(): Promise<DashboardOverview['traffic']> {
  const today = startOfToday();
  const yesterday = startOfYesterday();
  const week = startOfWeek();
  const month = startOfMonth();
  const calMonth = startOfCalendarMonth();
  const year = startOfYear();

  const [
    todayBytes,
    yesterdayBytes,
    last7dBytes,
    last30dBytes,
    calendarMonthBytes,
    currentYearBytes,
    prev7dBytes,
    prev30dBytes,
    lastCalendarMonthBytes,
    lastYearBytes,
    hourly,
  ] = await Promise.all([
    sumNodeUsageSince(today),
    sumNodeUsageSince(yesterday, today),
    sumNodeUsageSince(week),
    sumNodeUsageSince(month),
    sumNodeUsageSince(calMonth),
    sumNodeUsageSince(year),
    // Prior windows: [14d,7d), [60d,30d), last calendar month, last year.
    sumNodeUsageSince(daysAgo(14), week),
    sumNodeUsageSince(daysAgo(60), month),
    sumNodeUsageSince(startOfLastCalendarMonth(), calMonth),
    sumNodeUsageSince(startOfLastYear(), year),
    last24hHourly(),
  ]);

  return {
    todayBytes,
    yesterdayBytes,
    last7dBytes,
    last30dBytes,
    calendarMonthBytes,
    currentYearBytes,
    prev7dBytes,
    prev30dBytes,
    lastCalendarMonthBytes,
    lastYearBytes,
    last24hHourly: hourly,
  };
}

async function nodeMetrics(): Promise<{
  nodes: DashboardOverview['nodes'];
  system: DashboardOverview['system'];
}> {
  const today = startOfToday();
  const nodes = await prisma.node.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      address: true,
      protocol: true,
      status: true,
      countryCode: true,
      lastStatusChange: true,
      _count: { select: { profileBindings: true } },
    },
    orderBy: { name: 'asc' },
  });

  const todayUsage = await prisma.nodeUsageHistory.groupBy({
    by: ['nodeId'],
    where: { hour: { gte: today } },
    _sum: { downloadBytes: true, uploadBytes: true },
  });
  const todayByNode = new Map<string, number>();
  for (const r of todayUsage) {
    todayByNode.set(
      r.nodeId,
      (r._sum.downloadBytes ? Number(r._sum.downloadBytes) : 0) +
        (r._sum.uploadBytes ? Number(r._sum.uploadBytes) : 0),
    );
  }

  const metricsByNode = await Promise.all(
    nodes.map((n) => readCachedNodeMetrics(n.id)),
  );

  let onlineNodeCount = 0;
  const nodeRows: DashboardOverview['nodes'] = nodes.map((n, i) => {
    if (n.status === 'online') onlineNodeCount += 1;
    return {
      id: n.id,
      name: n.name,
      address: n.address,
      protocol: n.protocol,
      status: n.status,
      countryCode: n.countryCode,
      lastStatusChange: n.lastStatusChange ? n.lastStatusChange.toISOString() : null,
      inboundCount: n._count.profileBindings,
      todayBytes: todayByNode.get(n.id) ?? 0,
      metrics: metricsByNode[i],
    };
  });

  return {
    nodes: nodeRows,
    system: {
      onlineNodeCount,
      totalNodeCount: nodes.length,
    },
  };
}

async function protocolMetrics(): Promise<DashboardOverview['byProtocol']> {
  // Slice 27 — protocols come from the profile table now. Profile×bindings
  // is m:n; we count distinct profiles per protocol so the "1 protocol = N
  // inbound rows on N nodes" duplication doesn't inflate the dashboard.
  const inboundCounts = await prisma.profile.groupBy({
    by: ['protocol'],
    _count: { _all: true },
  });

  // Slice 27: per-protocol user count walks squad ACL → groupProfiles →
  // profile.protocol. The legacy users.enabled_protocols JSON column still
  // exists (kept for migration window) but is no longer authoritative —
  // squad membership is. A user is counted under a protocol if at least
  // one of their squads has a profile of that protocol.
  const userByProto = await prisma.$queryRaw<{ protocol: string; count: bigint }[]>`
    SELECT
      p.protocol,
      COUNT(DISTINCT u.id)::bigint AS count
    FROM users u
    INNER JOIN group_members gm ON gm.user_id = u.id
    INNER JOIN group_profiles gp ON gp.group_id = gm.group_id
    INNER JOIN profiles p ON p.id = gp.profile_id
    WHERE u.deleted_at IS NULL
      AND p.enabled = true
    GROUP BY p.protocol
  `;
  const userMap = new Map<string, number>();
  for (const r of userByProto) userMap.set(r.protocol, Number(r.count));

  const protocols = new Set<string>();
  for (const r of inboundCounts) protocols.add(r.protocol);
  for (const r of userByProto) protocols.add(r.protocol);

  return Array.from(protocols)
    .sort()
    .map((protocol) => ({
      protocol,
      inboundCount: inboundCounts.find((r) => r.protocol === protocol)?._count._all ?? 0,
      enabledUserCount: userMap.get(protocol) ?? 0,
    }));
}

async function topUsersToday(): Promise<DashboardOverview['topUsersToday']> {
  const today = startOfToday();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const usage = await prisma.nodeUserUsageHistory.groupBy({
    by: ['userId'],
    where: { date: todayDate },
    _sum: { bytesIn: true, bytesOut: true },
    orderBy: { _sum: { bytesIn: 'desc' } },
    take: TOP_USERS_LIMIT,
  });

  if (usage.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: usage.map((u) => u.userId) } },
    select: { id: true, username: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  return usage.map((u) => ({
    id: u.userId,
    username: nameById.get(u.userId) ?? '(deleted)',
    bytes:
      (u._sum.bytesIn ? Number(u._sum.bytesIn) : 0) +
      (u._sum.bytesOut ? Number(u._sum.bytesOut) : 0),
  }));
}

async function recentEvents(): Promise<DashboardOverview['recentEvents']> {
  const events = await prisma.subscriptionEvent.findMany({
    take: RECENT_EVENTS_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      eventType: true,
      userId: true,
      createdAt: true,
      user: { select: { username: true } },
    },
  });
  return events.map((e) => ({
    id: e.id.toString(),
    eventType: e.eventType,
    userId: e.userId,
    username: e.user?.username ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function getOverview(): Promise<DashboardOverview> {
  const cached = await redis.get(OVERVIEW_CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as DashboardOverview;
    } catch {
      // Corrupted cache — fall through and recompute.
    }
  }

  const [users, traffic, nodesAndSystem, byProtocol, topUsers, events, host, profileCount, squadCount] =
    await Promise.all([
      userMetrics(),
      trafficMetrics(),
      nodeMetrics(),
      protocolMetrics(),
      topUsersToday(),
      recentEvents(),
      collectSystemMetrics(),
      prisma.profile.count(),
      prisma.group.count(),
    ]);

  const overview: DashboardOverview = {
    users,
    traffic,
    system: nodesAndSystem.system,
    inventory: { profileCount, squadCount },
    host,
    nodes: nodesAndSystem.nodes,
    byProtocol,
    topUsersToday: topUsers,
    recentEvents: events,
  };

  // Best-effort: never let a Redis hiccup break the dashboard response.
  await redis
    .set(OVERVIEW_CACHE_KEY, JSON.stringify(overview), 'EX', OVERVIEW_CACHE_TTL_SECONDS)
    .catch(() => undefined);

  return overview;
}
