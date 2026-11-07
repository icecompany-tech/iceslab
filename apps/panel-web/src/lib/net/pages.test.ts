import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAllPages } from '@/lib/net/pages'
import { arr, num, obj, str } from '@/lib/net/parse'
import { stubServer } from '@/test/app'

const parsePage = (value: unknown) => {
  const page = obj({ rows: arr(str), total: num })(value)
  return { items: page.rows, total: page.total }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchAllPages', () => {
  it('reads a list longer than one page to its end', async () => {
    const pages: Record<string, string[]> = { '1': ['a', 'b'], '2': ['c'] }
    const server = stubServer({
      'GET /api/x': (r) => ({ body: { rows: pages[new URL(r.path, 'http://x').searchParams.get('page') ?? ''] ?? [], total: 3 } }),
    })
    expect(await fetchAllPages('/api/x', parsePage, 2)).toEqual(['a', 'b', 'c'])
    expect(server.sent).toHaveLength(2)
  })

  it('stops on an empty page though the total promised more', async () => {
    const server = stubServer({ 'GET /api/x': { body: { rows: [], total: 9 } } })
    expect(await fetchAllPages('/api/x', parsePage, 2)).toEqual([])
    expect(server.sent).toHaveLength(1)
  })
})
