import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseBulkReport, parseDelivery, parseDevices, parseEndpoints, parseUser, parseUsersPage, type User } from '@/contours/users/lib/users'
import type { UserBodyFields } from '@/contours/users/lib/userBody'
import { OVERVIEW_KEY } from '@/lib/domain/overview'
import { request, requestVoid } from '@/lib/net/client'
import { arr, nullable, obj, optional, str } from '@/lib/net/parse'

export const USERS_KEY = ['users'] as const

export type ListParams = Record<string, string | number>

export function useUsersList(params: ListParams) {
  return useQuery({
    queryKey: [...USERS_KEY, 'list', params],
    queryFn: () => request('/api/users', parseUsersPage, { params }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
}

export function useUserTags() {
  return useQuery({ queryKey: [...USERS_KEY, 'tags'], queryFn: () => request('/api/users/tags', obj({ tags: arr(str) })).then((r) => r.tags), staleTime: 60_000 })
}

const parseStatus = obj({ panel: optional(obj({ publicUrl: optional(nullable(str)), subscriptionPathPrefix: optional(nullable(str)) })) })

export function usePanelAddress() {
  return useQuery({ queryKey: ['auth', 'status', 'panel'], queryFn: () => request('/api/auth/status', parseStatus).then((r) => r.panel), staleTime: 300_000 })
}

export function useDelivery(id: string) {
  return useQuery({ queryKey: [...USERS_KEY, id, 'delivery'], queryFn: () => request(`/api/users/${id}/delivery`, parseDelivery).then((r) => r.routing ?? null) })
}

export function useEndpoints(id: string) {
  return useQuery({ queryKey: [...USERS_KEY, id, 'endpoints'], queryFn: () => request(`/api/users/${id}/endpoints`, parseEndpoints).then((r) => r.endpoints) })
}

export function useDevices(id: string) {
  return useQuery({ queryKey: [...USERS_KEY, id, 'devices'], queryFn: () => request(`/api/users/${id}/hwid-devices`, parseDevices).then((r) => r.devices) })
}

/** After a write the list, the status chips and the open window read again. */
function useRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: USERS_KEY })
    void client.invalidateQueries({ queryKey: OVERVIEW_KEY })
  }
}

export function useUpdateUser(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: UserBodyFields & { routingPreset?: null; customRoutingPresetId?: null }) => request(`/api/users/${id}`, parseUser, { method: 'PUT', body }),
    onSuccess: refresh,
  })
}

export function useCreateUser() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: object) => request('/api/users', parseUser, { method: 'POST', body }),
    onSuccess: refresh,
  })
}

export type UserAction = 'reset-traffic' | 'revoke' | 'rotate-subscription' | 'reissue-credentials'

export function useUserAction() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ user, action }: { user: Pick<User, 'id'>; action: UserAction }) => request(`/api/users/${user.id}/${action}`, parseUser, { method: 'POST' }),
    onSuccess: refresh,
  })
}

export function useDeleteUser() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => requestVoid(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}

export function useBulkAccess() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ userIds, action }: { userIds: string[]; action: 'enable' | 'disable' }) => request('/api/users/bulk', parseBulkReport, { method: 'POST', body: { userIds, action } }),
    onSuccess: refresh,
  })
}

export interface DeviceResetResult {
  done: number
  failed: number
}

/**
 * The old server drops devices one at a time: "Reset all" goes through them and tells the
 * real count, until Bk-118 gives one command (screens-map, 6.6).
 */
export function useResetDevices(userId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (ids: readonly string[]): Promise<DeviceResetResult> => {
      const answers = await Promise.allSettled(ids.map((id) => requestVoid(`/api/hwid-devices/${id}`, { method: 'DELETE' })))
      const failed = answers.filter((a) => a.status === 'rejected').length
      return { done: answers.length - failed, failed }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: [...USERS_KEY, userId, 'devices'] }),
  })
}
