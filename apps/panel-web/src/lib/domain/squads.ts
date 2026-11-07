// GET /api/squads, and what the old server reads into a squad's lists: no host rows means
// "every host of its profiles", and one such squad lifts the narrowing of all the others
// for its members (subscription.service.ts:755). Screens say this in words.
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { arr, maybe, nullable, num, obj, str } from '@/lib/net/parse'

/** Fixed by the server: squads.constants.ts. No contract constant to take it from yet. */
export const ALL_SQUAD_ID = '00000000-0000-0000-0000-000000000001'

const parseSquad = obj({
  id: str,
  name: str,
  description: nullable(str),
  profileIds: arr(str),
  hostIds: arr(str),
  memberCount: num,
  hwidDeviceLimit: nullable(num),
  routingPreset: maybe(nullable(str)),
  customRoutingPresetId: maybe(nullable(str)),
})

export type Squad = ReturnType<typeof parseSquad>

const parseSquads = obj({ squads: arr(parseSquad) })

export const SQUADS_KEY = ['squads'] as const

export function useSquads() {
  return useQuery({ queryKey: SQUADS_KEY, queryFn: () => request('/api/squads', parseSquads).then((r) => r.squads), staleTime: 30_000 })
}

export type SquadReach = 'all' | 'narrowed' | 'wide' | 'empty'

/**
 * `wide`: profiles and no host rows, gives every host of them, the future ones too.
 * `empty`: nothing at all, gives nothing itself and still lifts the narrowing of a neighbour.
 */
export function squadReach(squad: Pick<Squad, 'id' | 'hostIds' | 'profileIds'>): SquadReach {
  if (squad.id === ALL_SQUAD_ID) return 'all'
  if (squad.hostIds.length > 0) return 'narrowed'
  return squad.profileIds.length > 0 ? 'wide' : 'empty'
}

/**
 * The write that hands one new host to a squad, or null when none is needed. A narrowed or empty
 * squad gets the host and its profile; a squad without rows already gives every host of its
 * profiles, so it only ever gains the profile, and it is not narrowed behind the operator's back.
 */
export function grantHostBody(squad: Pick<Squad, 'id' | 'hostIds' | 'profileIds'>, hostId: string, profileId: string): { hostIds?: string[]; profileIds?: string[] } | null {
  const withProfile = squad.profileIds.includes(profileId) ? squad.profileIds : [...squad.profileIds, profileId]
  switch (squadReach(squad)) {
    case 'all':
      return null
    case 'wide':
      return squad.profileIds.includes(profileId) ? null : { profileIds: withProfile }
    case 'narrowed':
      return squad.hostIds.includes(hostId) ? null : { hostIds: [...squad.hostIds, hostId], profileIds: withProfile }
    case 'empty':
      return { hostIds: [hostId], profileIds: withProfile }
  }
}

/**
 * Squads that would lose their last host with these deletions. The row goes by cascade, the
 * profile stays, and the squad then reads as "all hosts" (squads.prisma:36, user-reach.ts:110).
 */
export function squadsLosingLastHost(hostIds: readonly string[], squads: readonly Pick<Squad, 'id' | 'name' | 'hostIds' | 'profileIds'>[]): string[] {
  return squads.filter((s) => s.hostIds.length > 0 && s.hostIds.every((h) => hostIds.includes(h))).map((s) => s.name)
}

export interface NarrowingFact {
  /** The squads of the user that have host rows. */
  narrowed: Squad[]
  /** The squads without rows: their presence means the rows above do not bind this user. */
  lifting: Squad[]
}

export function narrowingFact(groupIds: readonly string[], squads: readonly Squad[]): NarrowingFact {
  const mine = squads.filter((s) => groupIds.includes(s.id))
  return {
    narrowed: mine.filter((s) => squadReach(s) === 'narrowed'),
    lifting: mine.filter((s) => squadReach(s) !== 'narrowed'),
  }
}
