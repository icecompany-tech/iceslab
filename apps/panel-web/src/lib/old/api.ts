// The transport under the copied domain layer of the frozen panel (lib/old): the shape of the
// call it was written against, on the new client and its cookie. The answers are taken as the
// old code took them and read by its own tested helpers. It goes away with the Go API in S1,
// when every answer gets a parser at the edge (decision of 2026-11-06, screens-map 6.6).
import { requestLoose } from '@/lib/net/client'

interface Config {
  params?: object
  timeout?: number
  headers?: object
}

function clean(params?: object) {
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
    else if (typeof value === 'boolean') out[key] = String(value)
  }
  return out
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, config?: Config): Promise<{ data: T }> {
  const data = await requestLoose(path, { method, body, params: clean(config?.params), timeoutMs: config?.timeout })
  return { data: data as T }
}

export const api = {
  get: <T>(path: string, config?: Config) => call<T>('GET', path, undefined, config),
  post: <T>(path: string, body?: unknown, config?: Config) => call<T>('POST', path, body, config),
  put: <T>(path: string, body?: unknown, config?: Config) => call<T>('PUT', path, body, config),
  patch: <T>(path: string, body?: unknown, config?: Config) => call<T>('PATCH', path, body, config),
  delete: <T>(path: string, config?: Config) => call<T>('DELETE', path, undefined, config),
}
