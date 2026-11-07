import { describe, expect, it } from 'vitest'
import { DICT } from '@/contours/account/dict'
import { BOT_SCOPES, isFullToken, RESOURCES, scopesOf, togglePicked, tokenBody } from '@/contours/account/lib/tokenBody'

describe('tokenBody', () => {
  it('untouched form sends nothing: no name or no scopes closes the button', () => {
    expect(tokenBody({ name: '', set: 'bot', picked: [] })).toBeNull()
    expect(tokenBody({ name: '  ', set: 'full', picked: [] })).toBeNull()
  })

  it('B3: a manual pick with nothing is closed, an empty list never goes out', () => {
    expect(tokenBody({ name: 'n', set: 'manual', picked: [] })).toBeNull()
  })

  it('B3: full access only by an explicit star', () => {
    expect(tokenBody({ name: ' n ', set: 'full', picked: [] })).toEqual({ name: 'n', scopes: ['*'] })
  })

  it('a set sends its scopes, a manual pick only what is ticked', () => {
    expect(tokenBody({ name: 'n', set: 'bot', picked: ['nodes:read'] })?.scopes).toEqual([...BOT_SCOPES])
    expect(tokenBody({ name: 'n', set: 'manual', picked: ['nodes:read'] })?.scopes).toEqual(['nodes:read'])
    expect(scopesOf({ set: 'manual', picked: [] })).toEqual([])
  })

  it('ticking is a set', () => {
    expect(togglePicked(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(togglePicked(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(togglePicked(['a'], 'a', true)).toEqual(['a'])
  })

  it('a stored empty list reads as full, as the server reads it', () => {
    expect(isFullToken([])).toBe(true)
    expect(isFullToken(['*'])).toBe(true)
    expect(isFullToken(['users:read'])).toBe(false)
  })
})

describe('the sections', () => {
  it('every section has a word in both languages', () => {
    for (const dict of [DICT.ru, DICT.en]) expect(RESOURCES.filter((r) => typeof dict.resource[r] !== 'string')).toEqual([])
  })
})
