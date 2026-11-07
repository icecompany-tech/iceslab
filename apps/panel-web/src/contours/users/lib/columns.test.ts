import { describe, expect, it } from 'vitest'
import { COLUMNS, DEFAULT_VIEW, filterKeys, viewFromStored, visibleColumns, widthOf } from '@/contours/users/lib/columns'

describe('the column view', () => {
  it('shows eight of twenty-two by default, the user pinned first', () => {
    expect(COLUMNS).toHaveLength(22)
    const shown = visibleColumns(DEFAULT_VIEW)
    expect(shown).toHaveLength(8)
    expect(shown[0]?.id).toBe('username')
  })

  it('puts pins at the edges', () => {
    const shown = visibleColumns({ ...DEFAULT_VIEW, pins: { limit: 'left', status: 'right' } })
    expect(shown[0]?.id).toBe('limit')
    expect(shown.at(-1)?.id).toBe('status')
  })

  it('a stored view drops a removed column and picks up a new one', () => {
    const view = viewFromStored({ order: ['gone', 'tag'], hidden: ['gone', 'email'], pins: { gone: 'left', tag: 'right', uuid: 'odd' }, widths: { tag: 99, gone: 5 } })
    expect(view.order[0]).toBe('tag')
    expect(view.order).toHaveLength(22)
    expect(view.hidden).toEqual(['email'])
    expect(view.pins).toEqual({ tag: 'right' })
    expect(viewFromStored(null)).toBe(DEFAULT_VIEW)
    const tag = COLUMNS.find((c) => c.id === 'tag')
    expect(tag && widthOf(tag, view)).toBe(99)
  })

  it('a filter owns its request parameters', () => {
    expect(filterKeys({ kind: 'node' })).toEqual(['nodeId', 'online'])
    expect(filterKeys({ kind: 'search' })).toEqual([])
    expect(filterKeys(undefined)).toEqual([])
    expect(filterKeys({ kind: 'dates', after: 'createdAfter', before: 'createdBefore' })).toEqual(['createdAfter', 'createdBefore'])
  })
})
