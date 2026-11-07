// GET /api/dashboard/overview: one poll for the screen, the menu and the registers.
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { arr, maybe, nullable, num, obj, optional, record, str } from '@/lib/net/parse'

const parseNodeMetrics = obj({
  cpu: obj({ usagePercent: num, cores: num }),
  memory: obj({ totalBytes: num, usedBytes: num, usedPercent: num }),
  disk: obj({ totalBytes: num, usedBytes: num, usedPercent: num }),
  uptimeSeconds: num,
})

export const parseOverview = obj({
  users: obj({ total: num, byStatus: record(num), onlineNow: num, onlineToday: num }),
  traffic: obj({
    todayBytes: num,
    yesterdayBytes: num,
    last7dBytes: num,
    prev7dBytes: num,
    last30dBytes: num,
    prev30dBytes: num,
    calendarMonthBytes: num,
    currentYearBytes: num,
    last24hHourly: arr(obj({ hour: str, bytes: num })),
  }),
  system: obj({ onlineNodeCount: num, totalNodeCount: num }),
  inventory: obj({ profileCount: num, squadCount: num, hostCount: num }),
  host: maybe(
    obj({
      cpu: obj({ loadPercent: nullable(num), samplePercent: num, cores: num, loadavg: arr(num) }),
      memory: obj({ totalBytes: num, usedBytes: num, usedPercent: num }),
      disk: nullable(obj({ totalBytes: num, usedBytes: num, usedPercent: num })),
      process: obj({ rssBytes: num, heapUsedBytes: num, heapLimitBytes: num, uptimeSeconds: num }),
    }),
  ),
  nodes: arr(
    obj({
      id: str,
      name: str,
      address: str,
      status: str,
      countryCode: nullable(str),
      lastStatusChange: nullable(str),
      inboundCount: num,
      todayBytes: num,
      metrics: optional(nullable(parseNodeMetrics)),
    }),
  ),
})

export type Overview = ReturnType<typeof parseOverview>
export type OverviewNode = Overview['nodes'][number]

export const OVERVIEW_KEY = ['dashboard', 'overview'] as const

// The server caches this answer for 30 s: polling faster serves the same blob again.
const POLL_MS = 30_000

export function useOverview() {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => request('/api/dashboard/overview', parseOverview),
    refetchInterval: POLL_MS,
    staleTime: 10_000,
  })
}

export type NodeHealth = 'ok' | 'problem' | 'unverified' | 'off'

/** `unknown` is a node that never reported: not checked, which is not a problem and not fine. */
export function nodeHealth(status: string): NodeHealth {
  switch (status) {
    case 'online':
      return 'ok'
    case 'unknown':
      return 'unverified'
    case 'disabled':
      return 'off'
    default:
      return 'problem'
  }
}
