import { describe, expect, it } from 'vitest'
import { intervals, readTrafficSeries, type SeriesPeriod } from '@/contours/overview/hooks/useTrafficSeries'

function sample(period: SeriesPeriod) {
  const step = period === '1h' ? 60_000 : 86_400_000
  const points = Array.from({ length: intervals[period] }, (_, i) => ({
    at: new Date(Date.UTC(2026, 10, 1) + i * step).toISOString(),
    bytes: i % 2 ? null : 0,
    previousBytes: i % 2 ? 1 : null,
  }))
  return { period, points, canCompareTotals: false }
}

describe('recorded traffic series', () => {
  it.each(['1h', '7d', '90d'] as const)('keeps UTC slots, zeros and independent gaps for %s', period => {
    const parsed = readTrafficSeries(sample(period), period)
    expect(parsed.points).toHaveLength(intervals[period])
    expect(parsed.points[0]).toEqual({ date: '2026-11-01T00:00:00.000Z', bytes: 0, previousBytes: null })
    expect(parsed.points[1]?.previousBytes).toBe(1)
    expect(parsed.canCompareTotals).toBe(false)
  })

  it('rejects another period, truncated or unordered slots and invalid measurements', () => {
    const good = sample('7d')
    const first = good.points[0]!
    for (const bad of [
      { ...good, period: '90d' }, { ...good, canCompareTotals: 'false' },
      { ...good, points: good.points.slice(1) }, { ...good, points: [...good.points].reverse() },
      ...[{ bytes: -1 }, { previousBytes: 0.5 }, { at: '2026-11-01T01:00:00Z' },
        { at: '2026-11-01T00:00:00' }].map(change => ({ ...good, points: [{ ...first, ...change }, ...good.points.slice(1)] })),
    ]) expect(() => readTrafficSeries(bad, '7d')).toThrow()
  })
})
