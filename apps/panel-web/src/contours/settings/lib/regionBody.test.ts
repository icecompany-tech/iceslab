import { describe, expect, it } from 'vitest'
import { brandBody, regionNodes, regionUpdateBody } from '@/contours/settings/lib/regionBody'

describe('regionUpdateBody', () => {
  const stored = { name: 'Europe', code: 'EU' }

  it('untouched region sends nothing', () => {
    expect(regionUpdateBody(stored, { name: ' Europe ', code: 'EU' })).toEqual({})
  })

  it('a rename and a code change each send only themselves', () => {
    expect(regionUpdateBody(stored, { name: 'Asia', code: 'EU' })).toEqual({ name: 'Asia' })
    expect(regionUpdateBody(stored, { name: 'Europe', code: 'EA' })).toEqual({ code: 'EA' })
  })
})

describe('regionNodes', () => {
  it('a number only when the server said one', () => {
    expect(regionNodes({ nodeCount: 3 })).toBe(3)
    expect(regionNodes({ nodeCount: 0 })).toBe(0)
    expect(regionNodes({})).toBeNull()
    expect(regionNodes({ nodeCount: 'x' })).toBeNull()
  })
})

describe('brandBody', () => {
  it('untouched or emptied sends nothing, a name goes trimmed', () => {
    expect(brandBody('Ice', 'Ice')).toBeNull()
    expect(brandBody('Ice', '   ')).toBeNull()
    expect(brandBody('Ice', ' Slab ')).toEqual({ brandName: 'Slab' })
  })
})
