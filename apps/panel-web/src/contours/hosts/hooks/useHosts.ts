import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getProfileFormats } from '@/lib/old/formats'
import { createHost, deleteHost, getHostFreshness, listHosts, reorderHosts, updateHost, type CreateHostInput, type UpdateHostInput } from '@/lib/old/hosts'
import { listAllNodes } from '@/lib/old/nodes'
import { checkNodePort } from '@/lib/old/portCheck'
import { getProfileHostFields, listBindings, listProfiles } from '@/lib/old/profiles'
import { listSquads, updateSquad } from '@/lib/old/squads'
import type { Transport } from '@iceslab/shared'

const POLL_MS = 30_000

export const useHostsList = () => useQuery({ queryKey: ['hosts', 'all'], queryFn: () => listHosts(), refetchInterval: POLL_MS })
export const useBindingsList = () => useQuery({ queryKey: ['bindings', 'all'], queryFn: () => listBindings() })
export const useFleet = () => useQuery({ queryKey: ['fleet'], queryFn: () => listAllNodes(), refetchInterval: POLL_MS })
export const useProfilesList = () => useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() })
export const useOldSquads = () => useQuery({ queryKey: ['old-squads'], queryFn: listSquads })

export function useHostFields(profileId: string | null) {
  return useQuery({ queryKey: ['profile-host-fields', profileId], queryFn: () => getProfileHostFields(profileId ?? ''), enabled: profileId !== null })
}

export function useHostFormats(profileId: string | null, layer: 'default' | 'tls' | 'none') {
  return useQuery({ queryKey: ['profile-formats', profileId, layer], queryFn: () => getProfileFormats(profileId ?? '', layer), enabled: profileId !== null })
}

export const useFreshness = (id: string, enabled: boolean) => useQuery({ queryKey: ['host-freshness', id], queryFn: () => getHostFreshness(id), enabled, retry: false })

export function usePortCheck(nodeId: string | null, port: number | '', transport: Transport, exceptBindingId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['port-check', nodeId, port, transport, exceptBindingId],
    queryFn: () => checkNodePort(nodeId ?? '', { port: Number(port), transport, exceptBindingId }),
    enabled: enabled && nodeId !== null && port !== '',
    retry: false,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['hosts'] })
    void client.invalidateQueries({ queryKey: ['bindings'] })
  }
}

export function useCreateHost() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateHostInput) => createHost(input), onSuccess: refresh })
}

export function useUpdateHost(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: UpdateHostInput) => updateHost(id, input), onSuccess: refresh })
}

export function useDeleteHost() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteHost(id), onSuccess: refresh })
}

export function useReorderHosts() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (ids: string[]) => reorderHosts(ids), onSettled: refresh })
}

export interface GrantFailure {
  name: string
  message: string
}

/**
 * The "hand to squads" step until Bk-124: a second request per squad, each read fresh first so a
 * neighbour's edit is not overwritten. The host stands whatever happens here; a failure is named.
 */
export function useGrantHost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ hostId, profileId, squadIds, bodyOf, say }: { hostId: string; profileId: string; squadIds: readonly string[]; bodyOf: (squad: { id: string; hostIds: string[]; profileIds: string[] }, hostId: string, profileId: string) => { hostIds?: string[]; profileIds?: string[] } | null; say: (err: unknown) => string }): Promise<GrantFailure[]> => {
      const { squads } = await listSquads()
      const failures: GrantFailure[] = []
      for (const id of squadIds) {
        const squad = squads.find((s) => s.id === id)
        if (!squad) continue
        const body = bodyOf(squad, hostId, profileId)
        if (!body) continue
        try {
          await updateSquad(squad.id, body)
        } catch (err) {
          failures.push({ name: squad.name, message: say(err) })
        }
      }
      return failures
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['old-squads'] })
      void client.invalidateQueries({ queryKey: ['squads'] })
    },
  })
}
