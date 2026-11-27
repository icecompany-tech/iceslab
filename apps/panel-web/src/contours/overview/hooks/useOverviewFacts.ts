import { useQuery } from '@tanstack/react-query'
import { useNow } from '@/lib/clock'
import { expiringWeek } from '@/lib/domain/expiringUsers'
import { request } from '@/lib/net/client'
import { num, obj, str } from '@/lib/net/parse'

const parseTotal = obj({ total: num })
const parseHealth = obj({ status: str, db: str, redis: str })

/** The server has no such count: the list answers with its total, one row is enough. */
export function useExpiringSoon() {
  const now = useNow()
  return useQuery({
    queryKey: ['users', 'expiring'],
    queryFn: async () => {
      const window = expiringWeek(now())
      const {total} = await request('/api/users', parseTotal, {params: {limit: 1, status: 'active', ...window}})
      return {total, start: window.expiresAfter}
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

/** Users whose latest connection was through this node, across all user statuses. */
export function useLastNodeCount(nodeId: string) {
  return useQuery({
    queryKey: ['users', 'last-node-count', nodeId],
    queryFn: () => request('/api/users', parseTotal, { params: { nodeId, limit: 1 } }).then(r => r.total),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => request('/health', parseHealth), refetchInterval: 30_000 })
}
