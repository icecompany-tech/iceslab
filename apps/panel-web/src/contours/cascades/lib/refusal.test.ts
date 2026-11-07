import { describe, expect, it } from 'vitest'
import { readRefusal, refusalCount, refusedTags } from '@/contours/cascades/lib/refusal'
import { ApiError } from '@/lib/net/errors'

const refused = (status: number, body: object) => new ApiError({ status, body })

describe('readRefusal', () => {
  it('input first: nothing thrown reads as no refusal', () => {
    expect(readRefusal(null)).toBeNull()
    expect(readRefusal(new Error('x'))).toBeNull()
    expect(refusedTags(undefined)).toBeNull()
  })

  it('F-6: tags exhausted with its numbers', () => {
    expect(readRefusal(refused(409, { error: 'DIRECTION_TAGS_EXHAUSTED', needed: 2, available: 1 }))).toEqual({ kind: 'tags', needed: 2, available: 1 })
  })

  it('a node in another enabled cascade is named', () => {
    const r = readRefusal(refused(409, { error: 'NODE_IN_OTHER_CASCADE', nodeName: 'de-01', cascadeName: 'other', cascadeId: 'c2' }))
    expect(r).toMatchObject({ kind: 'otherCascade', taken: { nodeName: 'de-01', cascadeName: 'other' } })
  })

  it('a 400 keeps the server sentence, a 500 is not explained', () => {
    expect(readRefusal(refused(400, { error: 'INVALID', message: 'direction "DE" has a gone node' }))).toEqual({ kind: 'shape', message: 'direction "DE" has a gone node' })
    expect(readRefusal(refused(500, { message: 'boom' }))).toBeNull()
  })

  it('the top line counts the named places', () => {
    expect(refusalCount({ kind: 'entryChain', conflicts: [{ nodeName: 'a', engines: [] }, { nodeName: 'b', engines: [] }] })).toBe(2)
    expect(refusalCount({ kind: 'tags', needed: 1, available: 0 })).toBe(1)
    expect(refusalCount({ kind: 'underlay', names: [] })).toBe(1)
  })
})
