import { describe, expect, it } from 'vitest'
import { derivedProfileIds, draftOfSquad, droppedProfiles, membersBlockingEmpty, membersInEmptySquads, squadCreateBody, squadNameValid, squadUpdateBody, type HostRef } from '@/contours/squads/lib/squadBody'
import type { Squad } from '@/lib/old/squads'

const hosts: HostRef[] = [
  { id: 'h1', profileId: 'p1' },
  { id: 'h2', profileId: 'p1' },
  { id: 'h3', profileId: 'p2' }, // turned off and hidden hosts stand in this list like the rest
  { id: 'entry', profileId: 'p3' },
]

const squad = (over: Partial<Squad>): Squad => ({ id: 's', name: 'premium', description: null, profileIds: ['p1', 'p2'], exitAcl: [], policyIds: [], hostIds: [], routingPreset: null, customRoutingPresetId: null, hwidDeviceLimit: null, memberCount: 1, createdAt: '', updatedAt: '', ...over })

describe('the body of a squad save, gates B2', () => {
  it('an untouched form sends neither hostIds nor profileIds, nor exitAcl, nor policyIds', () => {
    const wide = squad({})
    const narrowed = squad({ hostIds: ['h1'], exitAcl: [{ cascadeId: 'c', directionIds: ['d'], exitNodeIds: ['n'] }], policyIds: ['x'] })
    for (const s of [wide, narrowed]) {
      const draft = draftOfSquad(s, hosts)
      expect(squadUpdateBody(draft, { ...draft }, hosts)).toEqual({})
    }
  })

  it('a change of name or limit does not touch the lists of a squad without narrowing', () => {
    const draft = draftOfSquad(squad({}), hosts)
    expect(squadUpdateBody(draft, { ...draft, name: 'x' }, hosts)).toEqual({ name: 'x' })
    expect(squadUpdateBody(draft, { ...draft, deviceLimit: '3' }, hosts)).toEqual({ hwidDeviceLimit: 3 })
  })

  it('unticking on a squad without narrowing sends every remaining host of all its profiles', () => {
    const draft = draftOfSquad(squad({}), hosts)
    expect(draft.picked).toEqual(['h1', 'h2', 'h3'])
    const body = squadUpdateBody(draft, { ...draft, hostsTouched: true, picked: ['h1', 'h3'] }, hosts)
    expect(body).toEqual({ hostIds: ['h1', 'h3'], profileIds: ['p1', 'p2'] })
  })

  it('profiles are derived from the whole choice, entries of a cascade too', () => {
    const draft = draftOfSquad(squad({ hostIds: ['h1'] }), hosts)
    const body = squadUpdateBody(draft, { ...draft, hostsTouched: true, picked: ['h1', 'entry'] }, hosts)
    expect(body).toEqual({ hostIds: ['h1', 'entry'], profileIds: ['p1', 'p3'] })
    expect(derivedProfileIds(['h3'], hosts)).toEqual(['p2'])
  })

  it('an empty choice sends both empty: an empty hostIds with profiles is out of reach', () => {
    const draft = draftOfSquad(squad({ hostIds: ['h1'] }), hosts)
    const body = squadUpdateBody(draft, { ...draft, hostsTouched: true, picked: [] }, hosts)
    expect(body).toEqual({ hostIds: [], profileIds: [] })
    for (const picked of [[], ['ghost'], ['h1']]) {
      const out = squadUpdateBody(draft, { ...draft, hostsTouched: true, picked }, hosts)
      if (out.hostIds?.length === 0) expect(out.profileIds).toEqual([])
    }
  })

  it('names a profile the choice no longer reaches, one with no hosts too', () => {
    expect(droppedProfiles(['p1', 'p2', 'empty'], ['h1'], hosts)).toEqual(['p2', 'empty'])
    expect(droppedProfiles(['p1'], ['h1'], hosts)).toEqual([])
  })

  it('exitAcl and policyIds travel only when edited, whole', () => {
    const draft = draftOfSquad(squad({ policyIds: ['a'] }), hosts)
    expect(squadUpdateBody(draft, { ...draft, policyIds: ['a', 'b'] }, hosts)).toEqual({ policyIds: ['a', 'b'] })
    expect(squadUpdateBody(draft, { ...draft, exitAcl: [{ cascadeId: 'c', directionIds: [] }] }, hosts)).toEqual({ exitAcl: [{ cascadeId: 'c', directionIds: [] }] })
  })

  it('a create sends the derived lists', () => {
    const draft = { ...draftOfSquad(null, hosts), name: 'n', picked: ['h3'] }
    expect(squadCreateBody(draft, hosts)).toMatchObject({ name: 'n', hostIds: ['h3'], profileIds: ['p2'] })
  })

  it('takes the name by the server rule', () => {
    expect(squadNameValid('premium 2_a-b')).toBe(true)
    for (const bad of ['', 'премиум', 'a/b', 'x'.repeat(65)]) expect(squadNameValid(bad)).toBe(false)
  })
})

describe('who stands in the way', () => {
  const others = [squad({ id: 'narrow', name: 'narrow', hostIds: ['h1'] }), squad({ id: 'empty', name: 'empty', hostIds: [], profileIds: [] }), squad({ id: 'wide', name: 'wide', hostIds: [] })]

  it('emptying is refused while a member stands in a narrowed squad, by name', () => {
    const members = [{ username: 'kate', groupIds: ['s', 'narrow'] }, { username: 'lena', groupIds: ['s'] }]
    expect(membersBlockingEmpty('s', members, others)).toEqual({ usernames: ['kate'], squadNames: ['narrow'] })
    expect(membersBlockingEmpty('s', [{ username: 'lena', groupIds: ['s'] }], others).usernames).toEqual([])
  })

  it('narrowing warns about members already in an empty squad', () => {
    const members = [{ username: 'kate', groupIds: ['s', 'empty'] }, { username: 'lena', groupIds: ['s', 'wide'] }]
    expect(membersInEmptySquads('s', members, others)).toEqual({ usernames: ['kate'], squadNames: ['empty'] })
  })
})
