import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRegion, deleteRegion, listRegions, updateRegion } from '@/lib/old/nodes'
import { addRecipeSource, deleteRecipeSource, getRecipeSources, updateRecipeSource } from '@/lib/old/recipes'
import { getSettings, getSystemVersion, updateSettings, type UpdateSettingsInput } from '@/lib/old/settings'

export const useSettings = () => useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings })
export const useRegions = () => useQuery({ queryKey: ['regions'], queryFn: listRegions })
export const useSources = () => useQuery({ queryKey: ['recipe-sources'], queryFn: getRecipeSources })
export const useVersion = () => useQuery({ queryKey: ['system', 'version-full'], queryFn: getSystemVersion })

export function useSaveSettings() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (input: UpdateSettingsInput) => updateSettings(input), onSuccess: () => void client.invalidateQueries({ queryKey: ['settings'] }) })
}

function useRegionsRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['regions'] })
    void client.invalidateQueries({ queryKey: ['fleet'] })
  }
}

export function useCreateRegion() {
  const refresh = useRegionsRefresh()
  return useMutation({ mutationFn: createRegion, onSuccess: refresh })
}

export function useUpdateRegion() {
  const refresh = useRegionsRefresh()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: { name?: string; code?: string } }) => updateRegion(id, input), onSuccess: refresh })
}

export function useDeleteRegion() {
  const refresh = useRegionsRefresh()
  return useMutation({ mutationFn: deleteRegion, onSuccess: refresh })
}

function useSourcesRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['recipe-sources'] })
    void client.invalidateQueries({ queryKey: ['recipes'] })
  }
}

export function useAddSource() {
  const refresh = useSourcesRefresh()
  return useMutation({ mutationFn: addRecipeSource, onSuccess: refresh })
}

export function useToggleSource() {
  const refresh = useSourcesRefresh()
  return useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRecipeSource(id, { enabled }), onSettled: refresh })
}

export function useDeleteSource() {
  const refresh = useSourcesRefresh()
  return useMutation({ mutationFn: deleteRecipeSource, onSuccess: refresh })
}
