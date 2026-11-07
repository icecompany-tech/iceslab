import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listCascades } from '@/lib/old/cascades'
import { clearConnLog, getConnLog } from '@/lib/old/connLog'
import { listHosts } from '@/lib/old/hosts'
import { getPolicyDrawing, listNodePolicies } from '@/lib/old/nodePolicies'
import { createNode, deleteNode, disableNodeWarp, findNode, getNodeExposure, getNodeSyncStatus, listAllNodes, listRegions, refreshNodeBootstrap, registerNodeWarp, rotateHysteriaTls, rotateNodeCert, updateNode, type CreateNodeInput, type UpdateNodeInput } from '@/lib/old/nodes'
import { listBindings, listProfiles, testConnectProfile } from '@/lib/old/profiles'
import { listRoutePolicies } from '@/lib/old/routePolicies'
import { listSquads } from '@/lib/old/squads'
import { OVERVIEW_KEY } from '@/lib/domain/overview'

const POLL_MS = 30_000

export const useFleet = () => useQuery({ queryKey: ['fleet'], queryFn: () => listAllNodes(), refetchInterval: POLL_MS })
export const useRegions = () => useQuery({ queryKey: ['regions'], queryFn: listRegions })
export const useCascades = () => useQuery({ queryKey: ['cascades'], queryFn: listCascades })
export const useNodePolicies = () => useQuery({ queryKey: ['node-policies'], queryFn: listNodePolicies })
export const useRoutePolicies = () => useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies })
export const useOldSquads = () => useQuery({ queryKey: ['old-squads'], queryFn: listSquads })

export function useNode(id: string) {
  return useQuery({ queryKey: ['node', id], queryFn: () => findNode(id), refetchInterval: POLL_MS })
}

export function useSyncStatus(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['node-sync', id], queryFn: () => getNodeSyncStatus(id), enabled, refetchInterval: POLL_MS })
}

export const useNodeHosts = (id: string) => useQuery({ queryKey: ['hosts', { nodeId: id }], queryFn: () => listHosts({ nodeId: id }) })
export const useNodeBindings = (id: string) => useQuery({ queryKey: ['bindings', { nodeId: id }], queryFn: () => listBindings({ nodeId: id }) })
export const useProfilesList = () => useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() })

export function usePolicyDrawing(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['policy-drawing', id], queryFn: () => getPolicyDrawing(id), enabled, retry: false })
}

export function useConnLog(id: string) {
  return useQuery({ queryKey: ['conn-log', id], queryFn: () => getConnLog(id), enabled: false, retry: false, staleTime: Infinity })
}

function useRefresh(id?: string) {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['fleet'] })
    void client.invalidateQueries({ queryKey: OVERVIEW_KEY })
    if (id) {
      void client.invalidateQueries({ queryKey: ['node', id] })
      void client.invalidateQueries({ queryKey: ['node-sync', id] })
      void client.invalidateQueries({ queryKey: ['policy-drawing', id] })
    }
  }
}

export function useCreateNode() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateNodeInput) => createNode(input), onSuccess: refresh })
}

export function useUpdateNode(id: string) {
  const refresh = useRefresh(id)
  return useMutation({ mutationFn: (input: UpdateNodeInput) => updateNode(id, input), onSuccess: refresh })
}

export function useDeleteNode() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteNode(id), onSuccess: refresh })
}

export function useWarp(id: string) {
  const refresh = useRefresh(id)
  return useMutation({ mutationFn: (on: boolean) => (on ? registerNodeWarp(id) : disableNodeWarp(id)), onSuccess: refresh })
}

export function useRotateCert(id: string) {
  const refresh = useRefresh(id)
  return useMutation({ mutationFn: () => rotateNodeCert(id), onSuccess: refresh })
}

export function useRotateHysteriaTls(id: string) {
  const refresh = useRefresh(id)
  return useMutation({ mutationFn: () => rotateHysteriaTls(id), onSuccess: refresh })
}

export function useReissueBootstrap(id: string) {
  return useMutation({ mutationFn: () => refreshNodeBootstrap(id) })
}

export const useExposure = (id: string) => useMutation({ mutationFn: () => getNodeExposure(id) })

export function useClearConnLog(id: string) {
  const client = useQueryClient()
  return useMutation({ mutationFn: () => clearConnLog(id), onSettled: () => void client.invalidateQueries({ queryKey: ['conn-log', id] }) })
}

/** The bypass until Bk-134 (screens-map 6.6): the old request by profile, the rows of this node. */
export function useNodeConnectTest(nodeName: string) {
  return useMutation({
    mutationFn: async (profileIds: readonly string[]) => {
      const answers = await Promise.all(profileIds.map((id) => testConnectProfile(id)))
      return answers.flatMap((a) => a.results).filter((r) => r.nodeName === nodeName)
    },
  })
}
