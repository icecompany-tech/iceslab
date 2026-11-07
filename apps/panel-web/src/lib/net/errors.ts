/** Not an answer at all: the network failed, or the time limit ran out. */
export const NO_ANSWER = 0

export class ApiError extends Error {
  readonly status: number
  /** The server's machine code, `error` in its JSON body. */
  readonly code: string | null
  /** The server's own words, `message` in its JSON body. */
  readonly serverMessage: string | null
  readonly body: unknown
  /** Seconds, from the Retry-After header. */
  readonly retryAfter: number | null

  constructor(init: { status: number; code?: string | null; serverMessage?: string | null; body?: unknown; retryAfter?: number | null }) {
    super(init.code ?? `HTTP ${init.status}`)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code ?? null
    this.serverMessage = init.serverMessage ?? null
    this.body = init.body
    this.retryAfter = init.retryAfter ?? null
  }

  /** The shape the helpers of the frozen panel read a refusal in (lib/old, copied libs). */
  get response(): { status: number; data: unknown } {
    return { status: this.status, data: this.body }
  }
}

/** Input checked first: null, a string and a foreign shape are "not mine" (F-K7). */
export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError
