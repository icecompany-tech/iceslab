// F-K5: a list to choose from, or to count on, is read whole, not its first page.
import { request } from '@/lib/net/client'
import type { Parser } from '@/lib/net/parse'

export interface Page<T> {
  items: readonly T[]
  total: number
}

/** `limit` is the server's own ceiling for that list: past it the server refuses. */
export async function fetchAllPages<T>(path: string, parsePage: Parser<Page<T>>, limit: number, params: Record<string, string | number> = {}): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; ; page += 1) {
    const answer = await request(path, parsePage, { params: { ...params, page, limit } })
    all.push(...answer.items)
    // An empty page ends it even if the total grew meanwhile: no endless loop.
    if (answer.items.length === 0 || all.length >= answer.total) return all
  }
}
