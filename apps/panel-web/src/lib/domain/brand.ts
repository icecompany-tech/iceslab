import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { obj, optional, str } from '@/lib/net/parse'

const parsePublic = obj({ brandName: optional(str) })

/** The panel's name, public: the sign-in shows it too. Until an answer, the product's. */
export function useBrandName(): string {
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => request('/api/settings/public', parsePublic), staleTime: 300_000 })
  return settings.data?.brandName ?? 'Iceslab'
}
