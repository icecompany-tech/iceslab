import { describe, expect, it } from 'vitest'
import { perUserPerDay, shareOf, unknownClients } from '@/contours/insights/lib/requests'

describe('requests', () => {
  it('unknown clients sum the two names the server uses', () => {
    expect(unknownClients([{ client: 'Happ', count: 5 }, { client: 'Other', count: 2 }, { client: 'Unknown', count: 3 }])).toBe(5)
    expect(unknownClients([])).toBe(0)
  })

  it('per user per day is null, not zero or infinity, when nobody fetched', () => {
    expect(perUserPerDay(70, 2, 7)).toBe(5)
    expect(perUserPerDay(0, 0, 7)).toBeNull()
  })

  it('a share is relative to the leader and safe on an empty list', () => {
    expect(shareOf(5, 10)).toBe(50)
    expect(shareOf(0, 0)).toBe(0)
  })
})
