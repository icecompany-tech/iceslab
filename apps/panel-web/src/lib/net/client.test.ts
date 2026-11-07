import { afterEach, describe, expect, it, vi } from 'vitest'
import { request, requestVoid } from '@/lib/net/client'
import { ApiError, isApiError, NO_ANSWER } from '@/lib/net/errors'
import { num, obj } from '@/lib/net/parse'

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }))

afterEach(() => vi.unstubAllGlobals())

const read = obj({ n: num })

describe('request', () => {
  it('reads an answer through its parser', async () => {
    vi.stubGlobal('fetch', respond(200, { n: 1 }))
    await expect(request('/api/x', read)).resolves.toEqual({ n: 1 })
  })

  it('sends the cookie and no token', async () => {
    const fetchStub = respond(200, { n: 1 })
    vi.stubGlobal('fetch', fetchStub)
    await request('/api/x', read, { method: 'POST', body: { a: 1 } })
    const init = fetchStub.mock.calls[0]?.at(1) as unknown as RequestInit
    expect(init.credentials).toBe('same-origin')
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i)
  })

  it('carries the code and the words of a refusal', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'NAME_TAKEN', message: 'taken' }, { 'retry-after': '7' }))
    const err = await request('/api/x', read).catch((e: unknown) => e)
    expect(isApiError(err)).toBe(true)
    expect(err).toMatchObject({ status: 409, code: 'NAME_TAKEN', serverMessage: 'taken', retryAfter: 7 })
  })

  it('a proxy page instead of JSON is a refusal with only the status', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>bad gateway</html>'))
    await expect(request('/api/x', read)).rejects.toMatchObject({ status: 502, code: null, serverMessage: null })
  })

  it('no network is its own status, not a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed') }))
    await expect(requestVoid('/api/x')).rejects.toMatchObject({ status: NO_ANSWER })
  })

  it('a shape the parser refuses is a failure, not data', async () => {
    vi.stubGlobal('fetch', respond(200, { n: 'one' }))
    await expect(request('/api/x', read)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('drops undefined parameters', async () => {
    const fetchStub = respond(200, { n: 1 })
    vi.stubGlobal('fetch', fetchStub)
    await request('/api/x', read, { params: { a: 1, b: undefined } })
    expect(fetchStub.mock.calls[0]?.at(0)).toBe('/api/x?a=1')
  })

  it('isApiError says no to everything else', () => {
    expect(isApiError(null)).toBe(false)
    expect(isApiError('x')).toBe(false)
    expect(isApiError({ status: 500 })).toBe(false)
    expect(isApiError(new ApiError({ status: 500 }))).toBe(true)
  })
})
