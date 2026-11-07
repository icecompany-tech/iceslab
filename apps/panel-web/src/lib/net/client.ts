// The one door to the server. Credentials are the httpOnly session cookie: no token is
// read, kept or sent by this code (F-14), the login response's `token` field is ignored.
import { ApiError, NO_ANSWER } from '@/lib/net/errors'
import { isRecord, type Parser } from '@/lib/net/parse'

function retryAfterOf(res: Response): number | null {
  const header = res.headers.get('retry-after')
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header) : null
}

async function refusalOf(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // A proxy's HTML page or an empty body: the status is all there is.
  }
  const record = isRecord(body) ? body : {}
  return new ApiError({
    status: res.status,
    code: typeof record.error === 'string' ? record.error : null,
    serverMessage: typeof record.message === 'string' ? record.message : null,
    body,
    retryAfter: retryAfterOf(res),
  })
}

interface Send {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number
}

function urlOf(path: string, params: Send['params']): string {
  if (!params) return path
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

async function send({ method = 'GET', body, params, timeoutMs }: Send, path: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(urlOf(path, params), {
      method,
      credentials: 'same-origin',
      // A file upload sets its own boundary.
      headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      signal: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new ApiError({ status: NO_ANSWER })
  }
  if (!res.ok) throw await refusalOf(res)
  return res
}

/** A JSON answer, read through its parser. A shape the parser refuses is a failure, not data. */
export async function request<T>(path: string, parse: Parser<T>, options: Send = {}): Promise<T> {
  const res = await send(options, path)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ApiError({ status: res.status, code: 'BAD_RESPONSE' })
  }
  try {
    return parse(json)
  } catch (err) {
    throw new ApiError({ status: res.status, code: 'BAD_RESPONSE', serverMessage: err instanceof Error ? err.message : null, body: json })
  }
}

/** For the frozen domain layer only (lib/old): the body as it came, nothing when it is empty. */
export async function requestLoose(path: string, options: Send = {}): Promise<unknown> {
  const res = await send(options, path)
  const text = await res.text()
  if (text === '') return undefined
  try {
    const body: unknown = JSON.parse(text)
    return body
  } catch {
    return text
  }
}

/** An answer whose body nothing reads: 204, or a write that only has to go through. */
export async function requestVoid(path: string, options: Send = {}): Promise<void> {
  await send(options, path)
}
