import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { arr, bool, nullable, num, obj, str } from '@/lib/net/parse'

export const intervals = { '1h': 60, '7d': 7, '90d': 90 } as const
export type SeriesPeriod = keyof typeof intervals
export type TrafficPeriod = SeriesPeriod | '24h' | '30d'

export function isSeriesPeriod(value: string | null): value is SeriesPeriod {
  return value === '1h' || value === '7d' || value === '90d'
}

const bucket = obj({ at: str, bytes: nullable(num), previousBytes: nullable(num) })
const parseSeries = obj({ period: str, points: arr(bucket), canCompareTotals: bool })

export function readTrafficSeries(value: unknown, period: SeriesPeriod) {
  const series = parseSeries(value)
  const step = period === '1h' ? 60_000 : 86_400_000
  if (series.period !== period || series.points.length !== intervals[period]) throw Error('period')
  const first = Date.parse(series.points[0]!.at)
  const points = series.points.map(({ at, bytes, previousBytes }, i) => {
    const time = Date.parse(at)
    if (time !== first + i * step || time % step !== 0 || !/(Z|\+00:00)$/.test(at)
      || (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0))
      || (previousBytes !== null && (!Number.isSafeInteger(previousBytes) || previousBytes < 0))) throw Error('interval')
    return { date: at, bytes, previousBytes }
  })
  return { points, canCompareTotals: series.canCompareTotals }
}

export function useTrafficSeries(period: SeriesPeriod) {
  return useQuery({
    queryKey: ['dashboard', 'traffic-series', period],
    queryFn: () => request('/api/dashboard/traffic-series', value => readTrafficSeries(value, period), { params: { period } }),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  })
}
