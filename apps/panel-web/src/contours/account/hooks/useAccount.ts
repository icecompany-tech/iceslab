import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/old/api'
import { createApiToken, deleteApiToken, listApiTokens } from '@/lib/old/settings'

export interface TotpSetup {
  secret: string
  uri: string
}

const STATUS_KEY = ['2fa-status']
const TOKENS_KEY = ['api-tokens']

export const use2faStatus = () =>
  useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      const { data } = await api.get<{ enabled: boolean }>('/api/auth/2fa/status')
      return data
    },
  })

function useStatusRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: STATUS_KEY })
}

export const useSetup2fa = () =>
  useMutation({
    mutationFn: async () => {
      const { data } = await api.post<TotpSetup>('/api/auth/2fa/setup')
      return data
    },
  })

export function useEnable2fa() {
  const refresh = useStatusRefresh()
  return useMutation({ mutationFn: (code: string) => api.post('/api/auth/2fa/enable', { code }), onSuccess: refresh })
}

export function useDisable2fa() {
  const refresh = useStatusRefresh()
  return useMutation({ mutationFn: (code: string) => api.post('/api/auth/2fa/disable', { code }), onSuccess: refresh })
}

export const useChangePassword = () => useMutation({ mutationFn: (body: { currentPassword: string; newPassword: string; totpCode?: string }) => api.put('/api/auth/password', body) })

export const useTokens = () => useQuery({ queryKey: TOKENS_KEY, queryFn: listApiTokens })

function useTokensRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: TOKENS_KEY })
}

export function useCreateToken() {
  const refresh = useTokensRefresh()
  return useMutation({ mutationFn: createApiToken, onSuccess: refresh })
}

export function useRevokeToken() {
  const refresh = useTokensRefresh()
  return useMutation({ mutationFn: deleteApiToken, onSettled: refresh })
}

/** Each on its own: one that fails leaves the others revoked, and the count says so. */
export function useRevokeAll() {
  const refresh = useTokensRefresh()
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteApiToken(id)))
      return results.filter((r) => r.status === 'fulfilled').length
    },
    onSettled: refresh,
  })
}
