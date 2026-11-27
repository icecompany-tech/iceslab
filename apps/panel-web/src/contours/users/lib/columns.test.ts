import { describe, expect, it, vi } from 'vitest'
import { COLUMNS, COLUMN_VIEW_KEY, DEFAULT_VIEW, filterKeys, loadColumnView, viewFromStored, visibleColumns, widthOf } from '@/contours/users/lib/columns'

describe('the column view', () => {
  it('places connection immediately after the node and keeps the date optional', () => {
    expect(COLUMNS).toHaveLength(23)
    const shown = visibleColumns(DEFAULT_VIEW)
    expect(shown).toHaveLength(9)
    expect(shown.slice(3, 5).map(c => c.id)).toEqual(['lastNode', 'connection'])
    expect(shown.map(c => c.id)).not.toContain('lastOnline')
    expect(shown[0]?.id).toBe('username')
  })

  it('upgrades the original default and preserves customized or newly saved layouts', () => {
    const old = { order: COLUMNS.filter(c => c.id !== 'connection').map(c => c.id), hidden: COLUMNS.filter(c => !c.def).map(c => c.id), pins: { username: 'left' }, widths: {} }
    const entries = new Map([['iceslab:user-columns', JSON.stringify(old)]])
    vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null })
    try {
      expect(loadColumnView()).toEqual(DEFAULT_VIEW)
      for (const change of [{ widths: { username: 251 } }, { pins: {} }, { order: [...old.order].reverse() }, { hidden: [...old.hidden, 'limit'] }, { hidden: old.hidden.filter(id => id !== 'lastOnline') }]) {
        const saved = { ...old, ...change }
        entries.set('iceslab:user-columns', JSON.stringify(saved))
        expect(loadColumnView()).toEqual({ ...saved, order: [...saved.order, 'connection'], hidden: [...saved.hidden, 'connection'] })
      }
      const manual = { ...DEFAULT_VIEW, hidden: [...DEFAULT_VIEW.hidden, 'connection'], widths: { lastOnline: 180 } }
      entries.set(COLUMN_VIEW_KEY, JSON.stringify(manual))
      expect(loadColumnView()).toEqual(manual)
    } finally { vi.unstubAllGlobals() }
  })

  it('puts pins at the edges', () => {
    const shown = visibleColumns({ ...DEFAULT_VIEW, pins: { limit: 'left', status: 'right' } })
    expect(shown[0]?.id).toBe('limit')
    expect(shown.at(-1)?.id).toBe('status')
  })

  it('a stored view drops a removed column and picks up a new one', () => {
    const view = viewFromStored({ order: ['gone', 'tag'], hidden: ['gone', 'email'], pins: { gone: 'left', tag: 'right', uuid: 'odd' }, widths: { tag: 99, gone: 5 } })
    expect(view.order[0]).toBe('tag')
    expect(view.order).toHaveLength(23)
    expect(view.hidden).toEqual(['email', 'connection'])
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
