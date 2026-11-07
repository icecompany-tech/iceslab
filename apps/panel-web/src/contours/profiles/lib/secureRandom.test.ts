import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomInt, randomToken } from '@/contours/profiles/lib/secureRandom'

/** crypto.getRandomValues that hands out these numbers in turn. */
const feed = (...values: number[]) => {
  const spy = vi.spyOn(crypto, 'getRandomValues')
  spy.mockImplementation((array) => {
    const view = array as Uint32Array
    view[0] = values.shift() ?? 0
    return array
  })
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('randomInt', () => {
  it('stays in the range, the upper bound is not reached', () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = randomInt(5, 9)
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThan(9)
    }
  })

  it('takes every value of the range', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomInt(0, 4)))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })

  it('throws away a draw past the last whole multiple, or low values would come up more often', () => {
    const spy = feed(4294967295, 7)
    // 2^32 % 10 = 6: everything from 4294967290 up is thrown away.
    expect(randomInt(0, 10)).toBe(7)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('reads from crypto, not from anything else', () => {
    const spy = feed(3)
    expect(randomInt(5, 2147483643)).toBe(8)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('randomToken', () => {
  it('has the asked length, lowercase letters and digits', () => {
    for (const length of [8, 16]) expect(randomToken(length)).toMatch(new RegExp(`^[a-z0-9]{${length}}$`))
  })

  it('two tokens differ', () => {
    expect(randomToken(16)).not.toBe(randomToken(16))
  })

  it('throws away a byte past the last whole multiple', () => {
    const spy = feed(255, 0)
    // 256 % 36 = 4: from 252 up is thrown away.
    expect(randomToken(1)).toBe('a')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
