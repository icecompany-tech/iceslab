import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/net/client';

/**
 * F1 - single source of the `/dashboard/overview` poll.
 *
 * Previously five call sites (AppLayout, DashboardPage, NodesPage, UsersPage,
 * NodeEditModal) each declared their own `refetchInterval` (30s / 15s / 10s /
 * none) against the SAME query key, so the effective cadence was an accidental
 * min-of-whatever-happened-to-be-mounted - a backend-load papercut.
 *
 * One hook, one interval. 30s matches the backend's 30s overview cache TTL:
 * polling faster only re-serves the same cached blob (no fresher data), so 30s
 * is both consistent AND the minimal-waste cadence. Tune it here, once.
 */
export function useOverview(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled: opts?.enabled ?? true,
  });
}

export interface NodeHostMetrics {
  cpu: {
    usagePercent: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    cores: number;
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  uptimeSeconds: number;
  collectedAt: string;
}

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
    // K1 - prior-period totals for "vs previous" deltas.
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
  inventory: {
    profileCount: number;
    squadCount: number;
    hostCount: number;
  };
  host: {
    cpu: {
      loadPercent: number | null;
      samplePercent: number;
      cores: number;
      loadavg: [number, number, number];
    };
    memory: { totalBytes: number; usedBytes: number; usedPercent: number };
    disk: {
      totalBytes: number;
      usedBytes: number;
      usedPercent: number;
      path: string;
    } | null;
    process: {
      rssBytes: number;
      heapUsedBytes: number;
      heapLimitBytes: number;
      uptimeSeconds: number;
    };
  };
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
    metrics: NodeHostMetrics | null;
  }[];
  byProtocol: {
    protocol: string;
    inboundCount: number;
    enabledUserCount: number;
  }[];
  topUsersToday: { id: string; username: string; bytes: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    userId: string;
    username: string | null;
    createdAt: string;
  }[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const { data } = await api.get<DashboardOverview>('/api/dashboard/overview');
  return data;
}

// ───── K1-b/c Insights (SRH + HWID inspectors) ─────

export interface Insights {
  windowDays: number;
  subRequests: {
    total: number;
    uniqueUsers: number;
    byClient: { client: string; count: number }[];
    byHourUtc: number[];
  };
  hwid: {
    totalDevices: number;
    usersWithDevices: number;
    avgDevicesPerUser: number;
    distribution: { bucket: string; users: number }[];
    atOrOverLimit: number;
  };
}

/** On-demand analytics over stored subscription-request + HWID data. `days`
 *  bounds the request-history window (HWID stats are point-in-time). */
export async function getInsights(days: number): Promise<Insights> {
  const { data } = await api.get<Insights>('/api/dashboard/insights', { params: { days } });
  return data;
}
