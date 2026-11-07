import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FilterParam, UserSort } from '@/contours/users/lib/columns'
import { useNow } from '@/lib/clock'

export type StatusFilter = 'all' | 'active' | 'expired' | 'limited' | 'disabled'

const SEARCH_WAIT_MS = 300
const WEEK_MS = 7 * 86_400_000
export const PAGE_SIZES = [10, 25, 50, 100, 500] as const

export function useListState() {
  const [url] = useSearchParams()
  const now = useNow()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Partial<Record<FilterParam, string>>>(() => {
    // The number on the Overview opens this list.
    if (url.get('filter') !== 'expiring') return {}
    const at = now()
    return { expiresAfter: new Date(at).toISOString(), expiresBefore: new Date(at + WEEK_MS).toISOString() }
  })
  const [sort, setSort] = useState<{ by: UserSort; order: 'asc' | 'desc' }>({ by: 'username', order: 'asc' })
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[1])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim())
      setPage(1)
    }, SEARCH_WAIT_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  const params = useMemo(() => {
    const out: Record<string, string | number> = { page, limit, sort: sort.by, order: sort.order }
    if (status !== 'all') out.status = status
    if (search !== '') out.search = search
    for (const [key, value] of Object.entries(filters)) if (value) out[key] = value
    return out
  }, [page, limit, sort, status, search, filters])

  const setFilter = (key: FilterParam, value: string) => {
    setFilters((all) => {
      const next = { ...all }
      if (value === '') delete next[key]
      else next[key] = value
      return next
    })
    setPage(1)
  }

  return {
    status,
    setStatus: (next: StatusFilter) => {
      setStatus(next)
      setPage(1)
    },
    searchText,
    setSearchText,
    filters,
    setFilter,
    resetAll: () => {
      setFilters({})
      setStatus('all')
      setSearchText('')
      setPage(1)
    },
    narrowed: status !== 'all' || search !== '' || Object.keys(filters).length > 0,
    filterCount: Object.keys(filters).length + (status !== 'all' ? 1 : 0) + (search !== '' ? 1 : 0),
    sort,
    toggleSort: (by: UserSort) => {
      setSort((now) => ({ by, order: now.by === by && now.order === 'asc' ? 'desc' : 'asc' }))
      setPage(1)
    },
    page,
    setPage,
    limit,
    setLimit: (next: number) => {
      setLimit(next)
      setPage(1)
    },
    params,
  }
}

export type ListState = ReturnType<typeof useListState>
