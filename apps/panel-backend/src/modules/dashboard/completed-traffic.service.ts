import { prisma } from '../../prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export interface CompletedUtc30dTraffic {
  dailyComparison?: { date: string; bytes: number; previousBytes: number }[];
  monthlyDirections?: { toUsers: number; fromUsers: number };
}

function utcDaysBefore(today: Date, days: number): Date {
  return new Date(today.getTime() - days * DAY_MS);
}

export async function readCompletedUtc30dTraffic(
  today: Date,
): Promise<CompletedUtc30dTraffic | undefined> {
  const rows = await prisma.dashboardClientTrafficDay.findMany({
    where: { date: { gte: utcDaysBefore(today, 2 * PERIOD_DAYS), lt: today } },
    select: { date: true, totalBytes: true, toUsersBytes: true, fromUsersBytes: true },
  });
  // These are finalized, fleet-wide client totals. The sparse node usage
  // history cannot distinguish missing observations from measured zeros.
  const byDate = new Map(rows.map((row) => [row.date.getTime(), row]));
  const dates = Array.from({ length: PERIOD_DAYS }, (_, i) => utcDaysBefore(today, PERIOD_DAYS - i));
  const current = dates.map((date) => byDate.get(date.getTime()));
  const previous = dates.map((date) => byDate.get(utcDaysBefore(date, PERIOD_DAYS).getTime()));
  const result: CompletedUtc30dTraffic = {};

  if (current.every((day) => day !== undefined) && previous.every((day) => day !== undefined)) {
    const sum = (days: typeof current) => days.reduce((bytes, day) => bytes + day.totalBytes, 0n);
    // The consumer sums JSON numbers. Both whole-window totals must be exact.
    if (sum(current) <= MAX_SAFE_BYTES && sum(previous) <= MAX_SAFE_BYTES) {
      result.dailyComparison = current.map((day, i) => ({
        date: day.date.toISOString().slice(0, 10),
        bytes: Number(day.totalBytes),
        previousBytes: Number(previous[i]!.totalBytes),
      }));
    }
  }

  let toUsers = 0n;
  let fromUsers = 0n;
  for (const day of current) {
    if (day?.toUsersBytes == null || day.fromUsersBytes == null) return result.dailyComparison ? result : undefined;
    toUsers += day.toUsersBytes;
    fromUsers += day.fromUsersBytes;
  }
  if (toUsers + fromUsers <= MAX_SAFE_BYTES) {
    result.monthlyDirections = { toUsers: Number(toUsers), fromUsers: Number(fromUsers) };
  }
  return result.dailyComparison || result.monthlyDirections ? result : undefined;
}
