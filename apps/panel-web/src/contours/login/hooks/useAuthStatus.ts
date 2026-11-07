import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseAdmin, SESSION_KEY } from '@/lib/auth/session'
import { request } from '@/lib/net/client'
import { bool, obj, optional, str } from '@/lib/net/parse'

const parseStatus = obj({ registration: obj({ enabled: bool }) })

/** Which form to show is the server's answer: a failure is not "registration closed" (A-238). */
export function useAuthStatus() {
  return useQuery({ queryKey: ['auth', 'status'], queryFn: () => request('/api/auth/status', parseStatus), staleTime: 0 })
}

// `token` is in this answer for the old panel. It is not read: the cookie is the session.
const parseLogin = obj({ admin: parseAdmin, token: optional(str) })

export interface Credentials {
  username: string
  password: string
  totpCode?: string
}

export function useSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password, totpCode }: Credentials) =>
      request('/api/auth/login', parseLogin, { method: 'POST', body: { username, password, ...(totpCode ? { totpCode } : {}) } }),
    onSuccess: ({ admin }) => {
      queryClient.setQueryData(SESSION_KEY, admin)
    },
  })
}
