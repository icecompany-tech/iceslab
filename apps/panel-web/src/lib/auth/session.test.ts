import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/net/errors'
import { isSignedOut, readLoginNotice, safeReturnPath, signOutOnServer } from '@/lib/auth/session'

afterEach(() => vi.unstubAllGlobals())

describe('signOutOnServer, F-2', () => {
  it('says true on 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(signOutOnServer()).resolves.toBe(true)
  })

  it('says false on 500 and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(signOutOnServer()).resolves.toBe(false)
  })

  it('says false when the time ran out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }))
    await expect(signOutOnServer()).resolves.toBe(false)
  })
})

describe('reading the answers', () => {
  it('only a 401 is signed out, a failed check is not', () => {
    expect(isSignedOut(new ApiError({ status: 401 }))).toBe(true)
    expect(isSignedOut(new ApiError({ status: 500 }))).toBe(false)
    expect(isSignedOut(new ApiError({ status: 0 }))).toBe(false)
    expect(isSignedOut(null)).toBe(false)
  })

  it('a login notice is read with the input checked first', () => {
    expect(readLoginNotice({ notice: 'logoutUnconfirmed' })).toBe('logoutUnconfirmed')
    expect(readLoginNotice({ notice: 'other' })).toBeNull()
    expect(readLoginNotice(null)).toBeNull()
    expect(readLoginNotice('x')).toBeNull()
  })
})

describe('the way back after the sign-in', () => {
  it('returns only inside the panel', () => {
    expect(safeReturnPath({ from: '/users?page=2' })).toBe('/users?page=2')
    for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/login', '/a\nb', 5, null]) expect(safeReturnPath({ from: evil })).toBe('/')
    for (const none of [null, undefined, 'x', {}]) expect(safeReturnPath(none)).toBe('/')
  })

  it('knows the expired session', () => {
    expect(readLoginNotice({ notice: 'sessionExpired' })).toBe('sessionExpired')
  })
})
