import { useQuery } from '@tanstack/react-query'
import { getInsights } from '@/lib/old/dashboard'

const STALE_MS = 60_000

/** Counted on demand on the server, so no poll: the period is the only thing that asks again. */
export const useInsights = (days: number) => useQuery({ queryKey: ['insights', days], queryFn: () => getInsights(days), staleTime: STALE_MS })
