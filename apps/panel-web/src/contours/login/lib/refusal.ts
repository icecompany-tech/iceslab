import { isApiError } from '@/lib/net/errors'
import { isRecord } from '@/lib/net/parse'

export type Refusal =
  | { kind: 'credentials' }
  | { kind: 'needCode' }
  | { kind: 'badCode' }
  | { kind: 'locked'; seconds: number }
  | { kind: 'other'; err: unknown }

/**
 * What a refused sign-in means for the form. Two refusals answer 429: the account lockout
 * (seconds in the body) and the route's rate limit (only in Retry-After, seen on the dev
 * panel after five wrong passwords, 2026-10-22). Body first, then the header.
 */
export function readRefusal(err: unknown): Refusal {
  if (!isApiError(err)) return { kind: 'other', err }
  if (err.status === 429) {
    const body = isRecord(err.body) ? err.body.retryAfterSeconds : undefined
    const seconds = typeof body === 'number' && body > 0 ? Math.ceil(body) : err.retryAfter
    return seconds !== null && seconds > 0 ? { kind: 'locked', seconds } : { kind: 'other', err }
  }
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return { kind: 'credentials' }
    case 'TOTP_REQUIRED':
      return { kind: 'needCode' }
    case 'INVALID_TOTP':
      return { kind: 'badCode' }
    case null:
    default:
      return { kind: 'other', err }
  }
}
