import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createGeoSet, deleteGeoSet, getGeoRolloutPlan, isNotImplemented, listGeoSets, refreshGeoSet, replaceGeoSetFile, rolloutGeoSet, uploadGeoSet } from '@/lib/old/geoSets'
import { listAllNodes } from '@/lib/old/nodes'

const CHECKING_POLL_MS = 3000
const KEY = ['geo-sets']

/** The download and the check run in the background (202): while one is checking the list asks again, or «checking» would hang forever. */
export function useGeoSetList() {
  return useQuery({
    queryKey: KEY,
    queryFn: listGeoSets,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
    refetchInterval: (query) => (query.state.data?.geoSets.some((s) => s.status === 'checking') ? CHECKING_POLL_MS : false),
  })
}

export const useAllNodes = (enabled = true) => useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listAllNodes(), enabled })

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: KEY })
}

export function useRefreshSet() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => refreshGeoSet(id), onSuccess: refresh })
}

export function useReplaceFile() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: { id: string; file: File }) => replaceGeoSetFile(input.id, input.file), onSuccess: refresh })
}

export function useDeleteSet() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteGeoSet(id), onSettled: refresh })
}

export function useCreateSet() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: createGeoSet, onSuccess: refresh })
}

export function useUploadSet() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: uploadGeoSet, onSuccess: refresh })
}

export const useRolloutPlan = (id: string) => useQuery({ queryKey: ['geo-rollout-plan', id], queryFn: () => getGeoRolloutPlan(id) })

export function useRollout(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (version: string) => rolloutGeoSet(id, version),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: KEY })
      void client.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}
