import { describe, expect, it } from 'vitest'
import { arr, maybe, num, obj, oneOf, optional, record, str } from '@/lib/net/parse'

describe('parse: F2 and F-K7', () => {
  const user = obj({ name: str, age: optional(num), note: maybe(str), tags: arr(str) })

  it.each([[null], [undefined], ['text'], [42], [[]]])('refuses %j without an exception of its own making', (bad) => {
    expect(() => user(bad)).toThrow(/expected an object/)
  })

  it('names the place that did not fit', () => {
    expect(() => user({ name: 'a', tags: ['x', 1] })).toThrow('tags[1]: expected a string')
  })

  it('keeps absent, null and a value apart', () => {
    expect(user({ name: 'a', tags: [] })).toEqual({ name: 'a', age: undefined, note: undefined, tags: [] })
    expect(user({ name: 'a', note: null, tags: [] }).note).toBeNull()
    expect(user({ name: 'a', note: 'n', tags: [] }).note).toBe('n')
  })

  it('does not take NaN or a numeric string for a number', () => {
    expect(() => num(Number.NaN)).toThrow()
    expect(() => num('1')).toThrow()
  })

  it('reads a set of names and a map', () => {
    expect(oneOf(['a', 'b'] as const)('a')).toBe('a')
    expect(() => oneOf(['a'] as const)('b')).toThrow(/expected a/)
    expect(record(num)({ a: 1 })).toEqual({ a: 1 })
  })
})
