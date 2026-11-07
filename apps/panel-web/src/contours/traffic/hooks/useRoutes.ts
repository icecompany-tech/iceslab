import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { refreshAfterNodePolicyChange } from '@/contours/traffic/lib/nodePolicyRefresh'
import { listCascades } from '@/lib/old/cascades'
import { getGeoTags, isNotImplemented, listGeoSets } from '@/lib/old/geoSets'
import { createNodePolicy, deleteNodePolicy, listNodePolicies, updateNodePolicy, type NodePolicyInput } from '@/lib/old/nodePolicies'
import { createRoutePolicy, createRoutingPreset, deleteRoutePolicy, deleteRoutingPreset, listRoutePolicies, listRoutingPresets, updateRoutePolicy, updateRoutingPreset, type RoutePolicyInput, type RoutingPresetInput } from '@/lib/old/routePolicies'
import { getSettings, updateSettings, type UpdateSettingsInput } from '@/lib/old/settings'
import { listSquads } from '@/lib/old/squads'

const TAGS_STALE_MS = 60_000
const SETS_STALE_MS = 30_000
const TAGS_SHOWN = 8

export const useNodePolicies = () => useQuery({ queryKey: ['node-policies'], queryFn: listNodePolicies })
export const useRoutePolicies = () => useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies })
export const usePresets = () => useQuery({ queryKey: ['routing-presets'], queryFn: listRoutingPresets })
export const useSettings = () => useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings })
export const useOldSquads = () => useQuery({ queryKey: ['old-squads'], queryFn: listSquads })
export const useCascadesList = () => useQuery({ queryKey: ['cascades'], queryFn: listCascades })

export function useSaveNodePolicy(id: string | null) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<NodePolicyInput>) => (id ? updateNodePolicy(id, input) : createNodePolicy(input as NodePolicyInput)),
    onSuccess: () => refreshAfterNodePolicyChange(client),
  })
}

export function useDeleteNodePolicy() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (id: string) => deleteNodePolicy(id), onSuccess: () => refreshAfterNodePolicyChange(client) })
}

function useRefresh(key: string) {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: [key] })
}

export function useSaveRoutePolicy(id: string | null) {
  const refresh = useRefresh('route-policies')
  return useMutation({
    mutationFn: (input: Partial<RoutePolicyInput>) => (id ? updateRoutePolicy(id, input as RoutePolicyInput) : createRoutePolicy(input as RoutePolicyInput)),
    onSuccess: refresh,
  })
}

export function useDeleteRoutePolicy() {
  const refresh = useRefresh('route-policies')
  const cascades = useRefresh('cascades')
  return useMutation({ mutationFn: (id: string) => deleteRoutePolicy(id), onSuccess: refresh, onError: cascades })
}

export function useSavePreset(id: string | null) {
  const refresh = useRefresh('routing-presets')
  return useMutation({
    mutationFn: (input: Partial<RoutingPresetInput>) => (id ? updateRoutingPreset(id, input) : createRoutingPreset(input as RoutingPresetInput)),
    onSettled: refresh,
  })
}

export function useDeletePreset() {
  const refresh = useRefresh('routing-presets')
  return useMutation({ mutationFn: (id: string) => deleteRoutingPreset(id), onSettled: refresh })
}

export function useSaveSettings() {
  const refresh = useRefresh('settings')
  return useMutation({ mutationFn: (input: UpdateSettingsInput) => updateSettings(input), onSuccess: refresh })
}

/** One key with the geo screen, so a dozen rows ask once. A server with no geo sets answers 404: the hint stays silent. */
export function useGeoSets() {
  const query = useQuery({ queryKey: ['geo-sets'], queryFn: listGeoSets, retry: (count, err) => !isNotImplemented(err) && count < 2, staleTime: SETS_STALE_MS })
  return useMemo(() => {
    const sets = query.data?.geoSets ?? []
    return { byName: new Map(sets.map((s) => [s.name, s])), kinds: new Map(sets.map((s) => [s.name, s.kind])) }
  }, [query.data])
}

export function useGeoTags(id: string | undefined, q: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: ['geo-tags', id, q], queryFn: () => getGeoTags(id ?? '', q ?? '', TAGS_SHOWN), enabled, staleTime: TAGS_STALE_MS })
}
