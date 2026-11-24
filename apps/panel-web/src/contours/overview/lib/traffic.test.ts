import { describe, expect, it } from 'vitest'
import { byAttention, certTone, changePercent, hourlyPoints, sumHourly } from '@/contours/overview/lib/traffic'

describe('overview numbers', () => {
  it('compares only with a previous period that had traffic', () => {
    expect(changePercent(110, 100)).toBeCloseTo(10)
    expect(changePercent(90, 100)).toBeCloseTo(-10)
    expect(changePercent(5, 0)).toBeNull()
  })

  it('keeps missing hourly samples distinct from zero across midnight UTC', () => {
    const points = hourlyPoints([
      { hour: '2026-11-23T23:00:00Z', bytes: 0 },
      { hour: '2026-11-24T01:00:00Z', bytes: 12 },
    ], Date.parse('2026-11-24T01:20:00Z'))
    expect(points).toHaveLength(24)
    expect(points.at(0)?.date).toBe('2026-11-23T02:00:00.000Z')
    expect(points.slice(-3).map(p => p.bytes)).toEqual([0, null, 12])
  })

  it('sums the hours', () => {
    expect(sumHourly([{ bytes: 2 }, { bytes: 3 }])).toBe(5)
    expect(sumHourly([])).toBe(0)
  })

  it('puts problems first, then not verified, then traffic', () => {
    const rows = [
      { name: 'a', todayBytes: 9, health: 'ok' },
      { name: 'b', todayBytes: 1, health: 'problem' },
      { name: 'c', todayBytes: 1, health: 'unverified' },
      { name: 'd', todayBytes: 10, health: 'ok' },
      { name: 'e', todayBytes: 99, health: 'off' },
    ]
    expect(byAttention(rows).map((r) => r.name)).toEqual(['b', 'c', 'd', 'a', 'e'])
  })

  it('reads the certificate term', () => {
    expect(certTone(-1)).toBe('expired')
    expect(certTone(6)).toBe('soon')
    expect(certTone(82)).toBe('fine')
  })
})
