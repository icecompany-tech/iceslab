import type { GetStatsResponse } from '@iceslab/shared';
import { prisma } from '../../prisma.js';

const MINUTE_MS = 60_000;
const MAX_POLL_GAP_MS = 45_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Counters = { in: bigint; out: bigint };
export interface NodePollObservation {
  id: string;
  startedAt: number;
  finishedAt: number;
  uptime: number;
  counters: Map<string, Counters>;
}

export function observeNodePoll(
  id: string, res: GetStatsResponse, startedAt: number, finishedAt: number,
): NodePollObservation {
  const counters = new Map<string, Counters>();
  // Xray can silently switch the node total to a sum of users when its
  // inbound query fails. Tagged cumulative user counters keep the same source.
  const supported = new Set<string>((res.cores ?? [])
    .filter((core) => (core.engine === 'xray' || core.engine === 'singbox') && core.cumulative && !core.noData)
    .map((core) => `${core.protocol}|${core.engine}`));
  for (const user of res.users ?? []) {
    if (!user.cumulative || !supported.has(`${user.protocol}|${user.engine}`)) continue;
    if (![user.bytesIn, user.bytesOut].every((n) => Number.isSafeInteger(n) && n >= 0)) continue;
    const key = `${user.userId}|${user.protocol}|${user.engine}`;
    const total = counters.get(key) ?? { in: 0n, out: 0n };
    total.in += BigInt(user.bytesIn);
    total.out += BigInt(user.bytesOut);
    counters.set(key, total);
  }
  return { id, startedAt, finishedAt, uptime: res.uptime, counters };
}

export function observedMinute(previous: NodePollObservation | undefined, current: NodePollObservation) {
  const minute = Math.floor(current.finishedAt / MINUTE_MS) * MINUTE_MS;
  if (!previous) return;
  if (current.startedAt < previous.finishedAt || current.finishedAt - previous.startedAt > MAX_POLL_GAP_MS) return;
  // Agent uptime is integer seconds. A discontinuity breaks the baseline.
  const elapsed = (current.startedAt - previous.startedAt) / 1000;
  const uptimeDelta = current.uptime - previous.uptime;
  if (!Number.isFinite(uptimeDelta) || uptimeDelta <= 0 || Math.abs(uptimeDelta - elapsed) > 3) return;

  let bytes: bigint | undefined;
  for (const [key, next] of current.counters) {
    const before = previous.counters.get(key);
    if (!before || next.in < before.in || next.out < before.out) continue;
    bytes = (bytes ?? 0n) + (next.in - before.in) + (next.out - before.out);
  }
  return bytes === undefined ? undefined : { minute: new Date(minute), bytes };
}

export async function pruneNodeMinuteTraffic(now = Date.now()): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM node_minute_traffic WHERE minute < ${new Date(now - DAY_MS).toISOString()}::timestamptz
  `;
}
