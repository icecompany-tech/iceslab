// What a save of a squad sends on the old server, whose lists mean more than they say (release
// gates B2): an empty `hostIds` means "every host of the profiles", so it must never go with
// profiles; one row narrows all the profiles of the squad; an untouched form sends no list.
import { canonicalAcl } from '@/contours/squads/lib/squadCascades'
import { presetChoiceOf, presetChoicePatch } from '@/lib/old/routingPresets'
import type { Squad, SquadExitAclEntry, UpdateSquadInput } from '@/lib/old/squads'

export interface HostRef {
  id: string
  profileId: string
}

export interface SquadDraft {
  name: string
  description: string
  deviceLimit: string
  preset: string
  /** The operator took the hosts into their own hands: only then the lists can travel. */
  hostsTouched: boolean
  picked: readonly string[]
  exitAcl: readonly SquadExitAclEntry[]
  policyIds: readonly string[]
}

export function draftOfSquad(squad: Squad | null, allHosts: readonly HostRef[]): SquadDraft {
  const narrowed = (squad?.hostIds.length ?? 0) > 0
  return {
    name: squad?.name ?? '',
    description: squad?.description ?? '',
    deviceLimit: squad?.hwidDeviceLimit == null ? '' : String(squad.hwidDeviceLimit),
    preset: squad ? presetChoiceOf(squad) : '',
    hostsTouched: false,
    // Without a narrowing the squad gives every host of its profiles: shown as they are.
    picked: squad ? (narrowed ? squad.hostIds : allHosts.filter((h) => squad.profileIds.includes(h.profileId)).map((h) => h.id)) : [],
    exitAcl: squad ? canonicalAcl(squad.exitAcl) : [],
    policyIds: squad?.policyIds ?? [],
  }
}

/** From the whole choice, hidden, turned off and cascade entries too: a missing one drops its node. */
export function derivedProfileIds(picked: readonly string[], allHosts: readonly HostRef[]): string[] {
  const set = new Set(picked)
  return [...new Set(allHosts.filter((h) => set.has(h.id)).map((h) => h.profileId))]
}

/** Profiles the squad gave that the new choice no longer reaches, and a profile with no hosts. */
export function droppedProfiles(stored: readonly string[], picked: readonly string[], allHosts: readonly HostRef[]): string[] {
  const kept = new Set(derivedProfileIds(picked, allHosts))
  return stored.filter((id) => !kept.has(id))
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))
const sameAcl = (a: readonly SquadExitAclEntry[], b: readonly SquadExitAclEntry[]) => JSON.stringify(canonicalAcl([...a]).sort((x, y) => x.cascadeId.localeCompare(y.cascadeId))) === JSON.stringify(canonicalAcl([...b]).sort((x, y) => x.cascadeId.localeCompare(y.cascadeId)))

export function hostListsBody(initial: SquadDraft, draft: SquadDraft, allHosts: readonly HostRef[]): { hostIds?: string[]; profileIds?: string[] } {
  if (!draft.hostsTouched || sameSet(initial.picked, draft.picked)) return {}
  // Both go together, whole: an empty list with profiles would read as "all hosts".
  const picked = draft.picked.filter((id) => allHosts.some((h) => h.id === id))
  return { hostIds: picked, profileIds: picked.length === 0 ? [] : derivedProfileIds(picked, allHosts) }
}

export function squadUpdateBody(initial: SquadDraft, draft: SquadDraft, allHosts: readonly HostRef[]): UpdateSquadInput {
  const body: UpdateSquadInput = { ...hostListsBody(initial, draft, allHosts) }
  if (draft.name.trim() !== initial.name) body.name = draft.name.trim()
  if (draft.description !== initial.description) body.description = draft.description.trim() || null
  if (draft.deviceLimit !== initial.deviceLimit) body.hwidDeviceLimit = draft.deviceLimit.trim() === '' ? null : Number(draft.deviceLimit)
  Object.assign(body, presetChoicePatch(initial.preset, draft.preset))
  if (!sameAcl(initial.exitAcl, draft.exitAcl)) body.exitAcl = [...draft.exitAcl]
  if (!sameSet(initial.policyIds, draft.policyIds)) body.policyIds = [...draft.policyIds]
  return body
}

export function squadCreateBody(draft: SquadDraft, allHosts: readonly HostRef[]) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    hwidDeviceLimit: draft.deviceLimit.trim() === '' ? null : Number(draft.deviceLimit),
    ...presetChoicePatch('', draft.preset),
    hostIds: [...draft.picked],
    profileIds: derivedProfileIds(draft.picked, allHosts),
    exitAcl: [...draft.exitAcl],
    policyIds: [...draft.policyIds],
  }
}

const NAME = /^[a-zA-Z0-9 _-]{1,64}$/
export const squadNameValid = (name: string) => NAME.test(name.trim())

export interface Member {
  username: string
  groupIds: readonly string[]
}

/** Members of this squad that also stand in a narrowed one, by squad name: B2, the ban on emptying. */
export function membersBlockingEmpty(selfId: string, members: readonly Member[], squads: readonly Pick<Squad, 'id' | 'name' | 'hostIds' | 'profileIds'>[]): { usernames: string[]; squadNames: string[] } {
  const narrowed = new Map(squads.filter((s) => s.id !== selfId && s.hostIds.length > 0).map((s) => [s.id, s.name]))
  const hit = members.filter((m) => m.groupIds.some((g) => narrowed.has(g)))
  const names = new Set(hit.flatMap((m) => m.groupIds.flatMap((g) => narrowed.get(g) ?? [])))
  return { usernames: hit.map((m) => m.username), squadNames: [...names] }
}

/** Members of this squad that stand in an empty one: narrowing it will not bind them. */
export function membersInEmptySquads(selfId: string, members: readonly Member[], squads: readonly Pick<Squad, 'id' | 'name' | 'hostIds' | 'profileIds'>[]): { usernames: string[]; squadNames: string[] } {
  const empty = new Map(squads.filter((s) => s.id !== selfId && s.hostIds.length === 0 && s.profileIds.length === 0).map((s) => [s.id, s.name]))
  const hit = members.filter((m) => m.groupIds.some((g) => empty.has(g)))
  const names = new Set(hit.flatMap((m) => m.groupIds.flatMap((g) => empty.get(g) ?? [])))
  return { usernames: hit.map((m) => m.username), squadNames: [...names] }
}
