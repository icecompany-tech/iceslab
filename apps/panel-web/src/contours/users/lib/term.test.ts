import { describe, expect, it } from 'vitest'
import { daysBetween, expireFromParts, extendFrom, termLeft } from '@/contours/users/lib/term'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const DAY = 86_400_000

describe('the term', () => {
  it('reads what is left to the nearest hour', () => {
    expect(termLeft(new Date(NOW + 30 * DAY - 5000).toISOString(), NOW)).toEqual({ days: 30, hours: 0 })
    expect(termLeft(new Date(NOW + 6 * DAY + 4 * 3_600_000).toISOString(), NOW)).toEqual({ days: 6, hours: 4 })
    expect(termLeft(new Date(NOW - DAY).toISOString(), NOW)).toEqual({ days: 0, hours: 0 })
  })

  it('builds a moment from days and hours', () => {
    expect(expireFromParts({ days: 1, hours: 2 }, NOW)).toBe(new Date(NOW + DAY + 2 * 3_600_000).toISOString())
  })

  it('extends from the current end, and an expired one from now, as the server counts', () => {
    expect(extendFrom(new Date(NOW + 6 * DAY).toISOString(), 30, NOW)).toBe(new Date(NOW + 36 * DAY).toISOString())
    expect(extendFrom(new Date(NOW - 6 * DAY).toISOString(), 30, NOW)).toBe(new Date(NOW + 30 * DAY).toISOString())
    expect(daysBetween(new Date(NOW).toISOString(), new Date(NOW + 30 * DAY).toISOString())).toBe(30)
  })
})
