// GET /api/nodes. Three values throughout: a missing key is a server older than the field,
// null is "never reported", and neither is "no" (F-K4).
import { useQuery } from '@tanstack/react-query'
import { fetchAllPages } from '@/lib/net/pages'
import { arr, nullable, num, obj, optional, str, type Parser } from '@/lib/net/parse'

export const NODES_PAGE_LIMIT = 100

const parseNodeRow = obj({
  id: str,
  name: str,
  address: str,
  status: str,
  countryCode: nullable(str),
  lastStatusChange: nullable(str),
  lastStatusMessage: nullable(str),
  certNotAfter: optional(nullable(str)),
  engines: optional(arr(str)),
  intendedEngines: optional(arr(str)),
})

export type NodeRow = ReturnType<typeof parseNodeRow>

const parseNodesPage: Parser<{ items: NodeRow[]; total: number }> = (value) => {
  const page = obj({ nodes: arr(parseNodeRow), total: num })(value)
  return { items: page.nodes, total: page.total }
}

export const NODES_KEY = ['nodes', 'all'] as const

export const fetchAllNodes = () => fetchAllPages('/api/nodes', parseNodesPage, NODES_PAGE_LIMIT)

export function useAllNodes() {
  return useQuery({ queryKey: NODES_KEY, queryFn: fetchAllNodes, refetchInterval: 30_000, staleTime: 10_000 })
}

/** Reported engines when the node has reported, what it is set up to carry when not. */
export const nodeEngines = (node: Pick<NodeRow, 'engines' | 'intendedEngines'>): readonly string[] | null => node.engines ?? node.intendedEngines ?? null

/** Whole days to the end of the certificate; null is unknown, which is not "expired". */
export function certDaysLeft(certNotAfter: string | null | undefined, now: number): number | null {
  if (!certNotAfter) return null
  const end = Date.parse(certNotAfter)
  return Number.isNaN(end) ? null : Math.floor((end - now) / 86_400_000)
}
