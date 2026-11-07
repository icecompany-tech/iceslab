import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { entryBystanders, entryHasAwg31 } from '@/contours/cascades/lib/cascadeForm'
import { createCascadeV4, deleteCascade, getCascadeStatus, listCascades, rotateCascadeTunnels, setCascadeEnabled, updateCascadeV4, type CreateCascadeV4Input, type UpdateCascadeV4Input } from '@/lib/old/cascades'
import { listNamedOutbounds } from '@/lib/old/namedOutbounds'
import { listAllNodes } from '@/lib/old/nodes'
import { listBindings, listProfiles } from '@/lib/old/profiles'
import { listRoutePolicies } from '@/lib/old/routePolicies'
import { listSquads } from '@/lib/old/squads'

const POLL_MS = 30_000
const STATUS_MS = 10_000

export const useCascadesList = () => useQuery({ queryKey: ['cascades'], queryFn: listCascades })
export const useFleet = () => useQuery({ queryKey: ['fleet'], queryFn: () => listAllNodes(), refetchInterval: POLL_MS })
export const useOutbounds = () => useQuery({ queryKey: ['named-outbounds'], queryFn: listNamedOutbounds })
export const useRoutePolicies = () => useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies })
export const useOldSquads = () => useQuery({ queryKey: ['old-squads'], queryFn: listSquads })
export const useBindingsAll = () => useQuery({ queryKey: ['bindings', 'all'], queryFn: () => listBindings() })

/** Stops asking once every node has taken the config; a save restarts it. */
export function useCascadeStatus(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['cascade-status', id], queryFn: () => getCascadeStatus(id), enabled, refetchInterval: (q) => (q.state.data?.done ? false : STATUS_MS) })
}

export function useCascadeStatuses(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => ({ queryKey: ['cascade-status', id], queryFn: () => getCascadeStatus(id), refetchInterval: POLL_MS })),
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['cascades'] })
    void client.invalidateQueries({ queryKey: ['fleet'] })
    void client.invalidateQueries({ queryKey: ['cascade-status'] })
  }
}

export function useCreateCascade() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateCascadeV4Input) => createCascadeV4(input), onSettled: refresh })
}

/** A cascade write commits fast and provisions later, so a timed-out answer can follow a change that landed: both ends refresh. */
export function useUpdateCascade(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: UpdateCascadeV4Input) => updateCascadeV4(id, input), onSettled: refresh })
}

export function useToggleCascade() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setCascadeEnabled(id, enabled), onSettled: refresh })
}

export function useDeleteCascade() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteCascade(id), onSettled: refresh })
}

export function useRotateTunnels(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (pair?: { fromNodeId: string; toNodeId: string }) => rotateCascadeTunnels(id, pair), onSettled: refresh })
}

/**
 * Bindings of the entry nodes and the profiles, only once there is an entry: a partial list would
 * say «nothing foreign» about a node not heard from yet, so nothing is answered until all came.
 */
function useEntryLists(active: boolean, ids: readonly string[]) {
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles(), enabled: active })
  const bindings = useQueries({ queries: ids.map((nodeId) => ({ queryKey: ['bindings', nodeId], queryFn: () => listBindings({ nodeId }), enabled: active })) })
  const failed = active && (profiles.isError || bindings.some((q) => q.isError))
  const list = bindings.every((q) => q.data) ? bindings.flatMap((q) => q.data?.bindings ?? []) : undefined
  return { bindings: list, profiles: profiles.data?.profiles, failed }
}

interface EntryNode {
  id: string
  name: string
  countryCode: string | null
}

export function useEntryFacts(entryProtocol: string | undefined, entryNodeIds: readonly string[], nodeById: ReadonlyMap<string, EntryNode>) {
  const ids = useMemo(() => entryNodeIds.filter(Boolean), [entryNodeIds])
  const active = Boolean(entryProtocol) && ids.length > 0
  const { bindings, profiles, failed } = useEntryLists(active, ids)
  const nodes = ids.flatMap((id) => {
    const node = nodeById.get(id)
    return node ? [node] : []
  })
  return {
    bystanders: active ? entryBystanders(entryProtocol, nodes, bindings, profiles) : undefined,
    awg31: entryProtocol === 'amneziawg' ? entryHasAwg31(bindings, profiles) : undefined,
    failed,
  }
}
