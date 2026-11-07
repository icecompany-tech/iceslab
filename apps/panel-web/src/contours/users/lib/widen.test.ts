import { describe, expect, it } from 'vitest'
import { widenedBy } from '@/contours/users/lib/widen'
import type { Squad } from '@/lib/domain/squads'

const squad = (id: string, hostIds: string[], profileIds: string[]): Squad => ({ id, name: id, description: null, hostIds, profileIds, memberCount: 0, hwidDeviceLimit: null, routingPreset: null, customRoutingPresetId: null })
const all = [squad('n', ['h'], ['p']), squad('e', [], []), squad('w', [], ['p'])]

describe('adding to an empty squad', () => {
  it('asks when the user keeps a narrowed squad', () => {
    expect(widenedBy(['n'], ['n', 'e'], all)?.empty.id).toBe('e')
  })
  it('does not ask for a wide squad, an old membership or no narrowing', () => {
    expect(widenedBy(['n'], ['n', 'w'], all)).toBeNull()
    expect(widenedBy(['n', 'e'], ['n', 'e'], all)).toBeNull()
    expect(widenedBy([], ['e'], all)).toBeNull()
  })
})
