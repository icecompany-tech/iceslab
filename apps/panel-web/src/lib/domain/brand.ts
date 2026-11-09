import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/net/client'
import { obj, optional, str } from '@/lib/net/parse'

const parsePublic = obj({ brandName: optional(str) })

/**
 * The panel's name, public: the sign-in shows it too. Blank while the server has not answered, so a
 * renamed panel never flashes the product's name first (owner, 10.11); the product's name only when
 * the answer has none or does not come.
 */
export function useBrandName(): string {
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => request('/api/settings/public', parsePublic), staleTime: 300_000 })
  if (settings.isPending) return ''
  return settings.data?.brandName ?? 'Iceslab'
}
