import { prisma } from '../../prisma.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PERIODS = { '1h': 60, '7d': 7, '90d': 90 } as const;

export type TrafficSeriesPeriod = keyof typeof PERIODS;

export async function getTrafficSeries(period: TrafficSeriesPeriod, now = Date.now()) {
  const step = period === '1h' ? MINUTE_MS : DAY_MS;
  const slots = PERIODS[period];
  const end = Math.floor(now / step) * step;
  const currentStart = end - slots * step;
  const previousStart = currentStart - slots * step;

  const rows = period === '1h'
    ? await prisma.$queryRaw<{ slot: string; bytes: string; complete: boolean }[]>`
        SELECT EXTRACT(epoch FROM minute)::bigint::text AS slot, SUM(bytes)::text AS bytes, false AS complete
        FROM node_minute_traffic
        WHERE minute >= ${new Date(previousStart).toISOString()}::timestamptz AND minute < ${new Date(end).toISOString()}::timestamptz
        GROUP BY minute
      `
    : await prisma.$queryRaw<{ slot: string; bytes: string; complete: boolean }[]>`
        WITH recorded AS (
          SELECT node_id, hour, download_bytes, upload_bytes
          FROM node_usage_history
          WHERE hour >= ${new Date(previousStart).toISOString()}::timestamptz AND hour < ${new Date(end).toISOString()}::timestamptz
        ), fleet AS (
          SELECT COUNT(DISTINCT node_id) AS nodes FROM recorded
        )
        SELECT EXTRACT(epoch FROM (hour AT TIME ZONE 'UTC')::date::timestamp)::bigint::text AS slot,
               SUM(download_bytes::numeric + upload_bytes)::text AS bytes,
               COUNT(*) = 24 * (SELECT nodes FROM fleet) AS complete
        FROM recorded
        GROUP BY 1
      `;

  const bySlot = new Map(rows.map((row) => [Number(row.slot) * 1000, row]));
  const points = Array.from({ length: slots }, (_, index) => {
    const at = currentStart + index * step;
    const current = bySlot.get(at);
    const previous = bySlot.get(previousStart + index * step);
    return {
      at: new Date(at).toISOString(),
      bytes: current ? Number(current.bytes) : null,
      previousBytes: previous ? Number(previous.bytes) : null,
    };
  });

  // Day totals are comparable as recorded traffic only when every UTC hour
  // is present for the same observed nodes. Minutes are partial observations.
  const canCompareTotals = rows.length === slots * 2 && rows.every((row) => row.complete)
    && [false, true].every((previous) => {
      const sum = points.reduce((total, point) => total + ((previous ? point.previousBytes : point.bytes) ?? 0), 0);
      return Number.isSafeInteger(sum);
    });
  return { period, points, canCompareTotals };
}
