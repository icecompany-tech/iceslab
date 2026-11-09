import { describe, expect, it } from 'vitest'
import { ALL_SQUAD_ID, grantHostBody, lastHostCheck, narrowingFact, squadReach, squadsLosingLastHost, type Squad } from '@/lib/domain/squads'

const squad = (id: string, hostIds: string[], profileIds: string[]): Squad => ({ id, name: id, description: null, hostIds, profileIds, memberCount: 0, hwidDeviceLimit: null, routingPreset: null, customRoutingPresetId: null })

describe('handing a host to a squad', () => {
  it('All needs nothing, a wide squad only gains the profile and is not narrowed', () => {
    expect(grantHostBody(squad(ALL_SQUAD_ID, [], ['p']), 'h', 'p')).toBeNull()
    expect(grantHostBody(squad('w', [], ['p']), 'h', 'p')).toBeNull()
    expect(grantHostBody(squad('w', [], ['p']), 'h', 'q')).toEqual({ profileIds: ['p', 'q'] })
  })

  it('a narrowed squad gets the host and its profile, an empty one both for the first time', () => {
    expect(grantHostBody(squad('n', ['a'], ['p']), 'h', 'q')).toEqual({ hostIds: ['a', 'h'], profileIds: ['p', 'q'] })
    expect(grantHostBody(squad('n', ['a'], ['p']), 'a', 'p')).toBeNull()
    expect(grantHostBody(squad('e', [], []), 'h', 'p')).toEqual({ hostIds: ['h'], profileIds: ['p'] })
  })

  it('names the squads that would lose their last host, even by a batch', () => {
    const squads = [squad('one', ['a'], ['p']), squad('two', ['a', 'b'], ['p']), squad('wide', [], ['p'])]
    expect(squadsLosingLastHost(['a'], squads)).toEqual(['one'])
    expect(squadsLosingLastHost(['a', 'b'], squads)).toEqual(['one', 'two'])
    expect(squadsLosingLastHost(['c'], squads)).toEqual([])
  })

  it('F-32: a list that is not in is "cannot tell", never "nobody loses"', () => {
    const squads = [squad('one', ['a'], ['p'])]
    expect(lastHostCheck(undefined, squads)).toBeNull()
    expect(lastHostCheck(['a'], undefined)).toBeNull()
    expect(lastHostCheck([], squads)).toEqual([])
    expect(lastHostCheck(['a'], squads)).toEqual(['one'])
  })
})

describe('what a squad reaches on the old server', () => {
  it('reads the four states', () => {
    expect(squadReach(squad(ALL_SQUAD_ID, [], ['p']))).toBe('all')
    expect(squadReach(squad('a', ['h'], ['p']))).toBe('narrowed')
    expect(squadReach(squad('a', [], ['p']))).toBe('wide')
    expect(squadReach(squad('a', [], []))).toBe('empty')
  })

  it('a squad without rows lifts the narrowing, an empty one too', () => {
    const narrow = squad('n', ['h'], ['p'])
    const wide = squad('w', [], ['p'])
    const empty = squad('e', [], [])
    expect(narrowingFact(['n'], [narrow, wide]).lifting).toEqual([])
    expect(narrowingFact(['n', 'w'], [narrow, wide]).lifting).toEqual([wide])
    expect(narrowingFact(['n', 'e'], [narrow, empty]).lifting).toEqual([empty])
  })
})
