import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getProfileFormats } from '@/lib/old/formats'
import { listHosts } from '@/lib/old/hosts'
import { generateInboundKeypair } from '@/lib/old/inbounds'
import { createProfile, deleteProfile, listBindings, listProfiles, testConnectProfile, updateProfile, type CreateProfileInput, type UpdateProfileInput } from '@/lib/old/profiles'
import { listAllNodes } from '@/lib/old/nodes'

const KEY = ['profiles'] as const

export const useProfilesList = () => useQuery({ queryKey: KEY, queryFn: () => listProfiles() })
export const useAllBindings = () => useQuery({ queryKey: ['bindings', 'all'], queryFn: () => listBindings() })
export const useAllHosts = () => useQuery({ queryKey: ['hosts', 'all'], queryFn: () => listHosts() })
export const useFleetNames = () => useQuery({ queryKey: ['fleet'], queryFn: () => listAllNodes() })
export const useFormats = (id: string | null) => useQuery({ queryKey: ['profile-formats', id], queryFn: () => getProfileFormats(id ?? '', 'default'), enabled: id !== null })

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: KEY })
}

export function useCreateProfile() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateProfileInput) => createProfile(input), onSuccess: refresh })
}

export function useUpdateProfile(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: UpdateProfileInput) => updateProfile(id, input), onSuccess: refresh })
}

export function useDeleteProfile() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteProfile(id), onSuccess: refresh })
}

export const useKeypair = () => useMutation({ mutationFn: (protocol: 'xray' | 'amneziawg') => generateInboundKeypair(protocol) })

/** E23 until Bk-134 (screens-map 6.6): the old check, read for its target rows after a save. */
export const useDestCheck = () =>
  useMutation({
    mutationFn: async (id: string) => (await testConnectProfile(id)).results.filter((r) => r.kind === 'dest' && !r.ok),
  })
