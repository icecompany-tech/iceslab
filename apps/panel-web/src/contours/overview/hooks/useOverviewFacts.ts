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
  // To the hour: a key that moves every second would refetch every second.
  const params = { limit: 1, status: 'active', ...expiringWeek(now()) }
  return useQuery({
    queryKey: ['users', 'expiring', params.expiresAfter],
    queryFn: () => request('/api/users', parseTotal, { params }).then((r) => r.total),
    staleTime: 60_000,
  })
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => request('/health', parseHealth), refetchInterval: 30_000 })
}
