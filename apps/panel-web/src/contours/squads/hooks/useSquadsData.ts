import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Member } from '@/contours/squads/lib/squadBody'
import { listCascades } from '@/lib/old/cascades'
import { listHosts } from '@/lib/old/hosts'
import { listNodePolicies } from '@/lib/old/nodePolicies'
import { listAllNodes } from '@/lib/old/nodes'
import { listBindings, listProfiles } from '@/lib/old/profiles'
import { listRoutePolicies, listRoutingPresets } from '@/lib/old/routePolicies'
import { createSquad, deleteSquad, listSquads, updateSquad, type CreateSquadInput, type UpdateSquadInput } from '@/lib/old/squads'
import { listUsers } from '@/lib/old/users'
import { SQUADS_KEY } from '@/lib/domain/squads'

const USERS_PAGE = 500

export const useOldSquads = () => useQuery({ queryKey: ['old-squads'], queryFn: listSquads })
export const useHostsAll = () => useQuery({ queryKey: ['hosts', 'all'], queryFn: () => listHosts() })
export const useBindingsAll = () => useQuery({ queryKey: ['bindings', 'all'], queryFn: () => listBindings() })
export const useProfilesAll = () => useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() })
export const useFleet = () => useQuery({ queryKey: ['fleet'], queryFn: () => listAllNodes() })
export const useCascadesAll = () => useQuery({ queryKey: ['cascades'], queryFn: listCascades })
export const useRoutePoliciesAll = () => useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies })
export const useNodePoliciesAll = () => useQuery({ queryKey: ['node-policies'], queryFn: listNodePolicies })
export const usePresetsAll = () => useQuery({ queryKey: ['routing-presets'], queryFn: listRoutingPresets })

/** Everyone in the squad, read whole (F-K5), only when a decision needs it. */
export async function fetchMembers(squadId: string): Promise<Member[]> {
  const all: Member[] = []
  for (let page = 1; ; page += 1) {
    const answer = await listUsers({ groupId: squadId, page, limit: USERS_PAGE })
    all.push(...answer.users.map((u) => ({ username: u.username, groupIds: u.groupIds })))
    if (answer.users.length === 0 || all.length >= answer.total) return all
  }
}

function useRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['old-squads'] })
    void client.invalidateQueries({ queryKey: SQUADS_KEY })
  }
}

export function useCreateSquad() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateSquadInput) => createSquad(input), onSuccess: refresh })
}

export function useUpdateSquad(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: UpdateSquadInput) => updateSquad(id, input), onSuccess: refresh })
}

export function useDeleteSquad() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteSquad(id), onSuccess: refresh })
}
