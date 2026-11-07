import { describe, expect, it } from 'vitest'
import { readSaveRefusal } from '@/contours/users/lib/refusal'
import { ApiError } from '@/lib/net/errors'

describe('a refused save', () => {
  it('is not mine when it is not a refusal', () => {
    for (const v of [null, undefined, 'x', {}, new Error('x')]) expect(readSaveRefusal(v)).toBeNull()
    expect(readSaveRefusal(new ApiError({ status: 500, serverMessage: 'boom' }))).toBeNull()
  })

  it('a taken name stands at the name', () => {
    expect(readSaveRefusal(new ApiError({ status: 409, code: 'USERNAME_TAKEN', serverMessage: 'taken' }))?.fields.username).toBe('taken')
  })

  it('validation goes field by field, the rest to the form', () => {
    const body = { issues: [{ path: ['trafficLimitGb'], message: 'int' }, { path: ['other'], message: 'odd' }, null] }
    const refusal = readSaveRefusal(new ApiError({ status: 400, code: 'VALIDATION_ERROR', body }))
    expect(refusal?.fields.limit).toBe('int')
    expect(refusal?.message).toBe('odd')
  })

  it('any other sentence is said at the form', () => {
    expect(readSaveRefusal(new ApiError({ status: 404, code: 'NOT_FOUND', serverMessage: 'gone' }))?.message).toBe('gone')
  })
})
