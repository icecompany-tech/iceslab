import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { isApiError } from '@/lib/net/errors'
import { num, obj } from '@/lib/net/parse'

const parseTotal = obj({ total: num })

export const userCountForbidden = (error: unknown) => isApiError(error) && error.status === 403

/** Counts users whose latest observed activity was on this node, across all user statuses. */
export function useLastNodeCount(nodeId: string, enabled = true) {
  return useQuery({
    queryKey: ['users', 'last-node-count', nodeId],
    queryFn: () => request('/api/users', parseTotal, { params: { nodeId, limit: 1 } }).then(r => r.total),
    enabled,
    staleTime: 60_000,
    refetchInterval: query => userCountForbidden(query.state.error) ? false : 60_000,
  })
}
