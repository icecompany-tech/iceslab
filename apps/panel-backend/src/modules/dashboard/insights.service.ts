import { prisma } from '../../prisma.js';
import { classifyClient } from './clients.js';

// K1-b/c Insights: on-demand analytics over data we already store but never
// surfaced: subscription-request history (who polls the sub URL, with which
// client, at what hour) and HWID device tracking (how many devices per user,
// who's at their sharing cap). Distinct from the dashboard overview: that DTO
// is polled every 30s by every tab and is kept lean; these aggregates are
// heavier and only computed when an admin opens the Insights page, so they get
// their own endpoint with no Redis cache (a deliberate click, not a poll).

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;
// Device-count buckets for the HWID sharing histogram. Anything >= the last
// edge folds into the top "5+" bucket.
const DEVICE_BUCKETS = [1, 2, 3, 4] as const;

export interface InsightsResponse {
  windowDays: number;
  subRequests: {
    total: number;
    uniqueUsers: number;
    // Request count per canonical client family, biggest first.
    byClient: { client: string; count: number }[];
    // 24-bucket histogram of request hour-of-day (UTC). Always length 24,
    // index = hour, so the frontend can render a fixed bar row.
    byHourUtc: number[];
  };
  hwid: {
    totalDevices: number;
    usersWithDevices: number;
    // totalDevices / usersWithDevices, rounded to 2dp; 0 when nobody has a
    // device yet.
    avgDevicesPerUser: number;
    // How many users have exactly 1, 2, 3, 4, or 5+ tracked devices. Surfaces
    // subscription-sharing at a glance.
    distribution: { bucket: string; users: number }[];
    // Users whose tracked device count has reached or passed their
    // hwidDeviceLimit (the next fetch from a new device 403s). Only counts
    // users with a positive limit set.
    atOrOverLimit: number;
  };
}

function clampWindowDays(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_WINDOW_DAYS;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return n;
}

async function subRequestInsights(
  since: Date,
): Promise<InsightsResponse['subRequests']> {
  // groupBy on the raw UA string: the DB does the heavy counting, JS only maps
  // the (small) distinct-UA list to families. uniqueUsers + the hour histogram
  // need a window scan, done in raw SQL so Postgres extracts the hour and
  // counts distinct users server-side instead of shipping every row over.
  const [uaGroups, hourRows, distinctUsers] = await Promise.all([
    prisma.subscriptionRequestHistory.groupBy({
      by: ['userAgent'],
      where: { requestedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ hour: number; count: bigint }[]>`
      SELECT date_part('hour', requested_at AT TIME ZONE 'UTC')::int AS hour,
             COUNT(*)::bigint AS count
      FROM subscription_request_history
      WHERE requested_at >= ${since}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT user_id)::bigint AS count
      FROM subscription_request_history
      WHERE requested_at >= ${since}
    `,
  ]);

  const byClientMap = new Map<string, number>();
  let total = 0;
  for (const g of uaGroups) {
    const n = g._count._all;
    total += n;
    const client = classifyClient(g.userAgent);
    byClientMap.set(client, (byClientMap.get(client) ?? 0) + n);
  }
  const byClient = Array.from(byClientMap, ([client, count]) => ({ client, count })).sort(
    (a, b) => b.count - a.count,
  );

  const byHourUtc = new Array<number>(24).fill(0);
  for (const r of hourRows) {
    if (r.hour >= 0 && r.hour < 24) byHourUtc[r.hour] = Number(r.count);
  }

  return {
    total,
    uniqueUsers: distinctUsers[0] ? Number(distinctUsers[0].count) : 0,
    byClient,
    byHourUtc,
  };
}

async function hwidInsights(): Promise<InsightsResponse['hwid']> {
  // Per-user device counts drive both the average and the sharing histogram.
  // atOrOverLimit is a HAVING-filtered count done in SQL so we don't pull every
  // user row just to compare against the per-user limit.
  const [perUser, totalDevices, atOrOverLimitRows] = await Promise.all([
    prisma.hwidUserDevice.groupBy({
      by: ['userId'],
      _count: { _all: true },
    }),
    prisma.hwidUserDevice.count(),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT u.id
        FROM users u
        JOIN hwid_user_devices d ON d.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND u.hwid_device_limit IS NOT NULL
          AND u.hwid_device_limit > 0
        GROUP BY u.id, u.hwid_device_limit
        HAVING COUNT(d.id) >= u.hwid_device_limit
      ) capped
    `,
  ]);

  const usersWithDevices = perUser.length;
  const avgDevicesPerUser =
    usersWithDevices === 0 ? 0 : Math.round((totalDevices / usersWithDevices) * 100) / 100;

  // Bucket users by their device count: 1, 2, 3, 4, then 5+.
  const bucketCounts = new Array<number>(DEVICE_BUCKETS.length + 1).fill(0);
  for (const u of perUser) {
    const c = u._count._all;
    const idx = DEVICE_BUCKETS.findIndex((edge) => c === edge);
    bucketCounts[idx === -1 ? DEVICE_BUCKETS.length : idx] += 1;
  }
  const distribution = [
    ...DEVICE_BUCKETS.map((edge, i) => ({ bucket: String(edge), users: bucketCounts[i] })),
    { bucket: `${DEVICE_BUCKETS.length + 1}+`, users: bucketCounts[DEVICE_BUCKETS.length] },
  ];

  return {
    totalDevices,
    usersWithDevices,
    avgDevicesPerUser,
    distribution,
    atOrOverLimit: atOrOverLimitRows[0] ? Number(atOrOverLimitRows[0].count) : 0,
  };
}

export async function getInsights(windowDaysRaw?: number): Promise<InsightsResponse> {
  const windowDays = clampWindowDays(windowDaysRaw);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [subRequests, hwid] = await Promise.all([subRequestInsights(since), hwidInsights()]);

  return { windowDays, subRequests, hwid };
}
