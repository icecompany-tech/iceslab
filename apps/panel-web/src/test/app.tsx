// What a screen test stands on: its router, its cache, a fixed clock, a server it scripts.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { ClockProvider } from '@/lib/clock'

export const NOW = Date.parse('2026-11-06T12:00:00Z')

export function renderApp(ui: ReactNode, options: { route?: string; state?: unknown; client?: QueryClient } = {}) {
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <ClockProvider value={() => NOW}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: (options.route ?? '/').split('?')[0], search: options.route?.includes('?') ? `?${options.route.split('?')[1]}` : '', state: options.state }]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </ClockProvider>,
  )
  return { ...rendered, client }
}

export interface Answer {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Never answers: the screen stays in its loading state for the whole test. */
  hold?: boolean
}

export interface SentRequest {
  method: string
  path: string
  body: unknown
}

type Handler = Answer | ((request: SentRequest) => Answer)

/**
 * A scripted server: `'GET /api/x'` to an answer. A request nobody scripted is a 500, so
 * a screen that asks for something new fails its test by name in `server.unknown`.
 */
export function stubServer(routes: Record<string, Handler>) {
  const sent: SentRequest[] = []
  const unknown: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://panel.test')
      const method = init?.method ?? 'GET'
      const request: SentRequest = { method, path: url.pathname + url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
      sent.push(request)
      const handler = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`]
      if (handler === undefined) {
        unknown.push(`${method} ${url.pathname}`)
        return new Response('{}', { status: 500 })
      }
      const { status = 200, body, headers, hold } = typeof handler === 'function' ? handler(request) : handler
      if (hold) return new Promise<Response>(() => undefined)
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers })
    }),
  )
  return { sent, unknown, writes: () => sent.filter((r) => r.method !== 'GET') }
}
