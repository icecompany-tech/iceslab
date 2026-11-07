import { describe, expect, it } from 'vitest'
import { readRefusal } from '@/contours/login/lib/refusal'
import { ApiError } from '@/lib/net/errors'

describe('readRefusal', () => {
  it.each([[null], [undefined], ['x'], [{}]])('%j is not a refusal of the server', (bad) => {
    expect(readRefusal(bad).kind).toBe('other')
  })

  it('reads the codes', () => {
    expect(readRefusal(new ApiError({ status: 401, code: 'INVALID_CREDENTIALS' })).kind).toBe('credentials')
    expect(readRefusal(new ApiError({ status: 401, code: 'TOTP_REQUIRED' })).kind).toBe('needCode')
    expect(readRefusal(new ApiError({ status: 401, code: 'INVALID_TOTP' })).kind).toBe('badCode')
  })

  it('a lockout takes the seconds from the body first', () => {
    const err = new ApiError({ status: 429, code: 'ACCOUNT_LOCKED', body: { retryAfterSeconds: 41.5 }, retryAfter: 90 })
    expect(readRefusal(err)).toEqual({ kind: 'locked', seconds: 42 })
  })

  it('a rate limit carries them only in the header', () => {
    expect(readRefusal(new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfter: 60 }))).toEqual({ kind: 'locked', seconds: 60 })
  })

  it('a 429 naming no wait is not a lockout with no end', () => {
    expect(readRefusal(new ApiError({ status: 429 })).kind).toBe('other')
  })
})
