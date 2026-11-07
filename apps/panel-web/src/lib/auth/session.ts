// Who is signed in is what the server says (F-14), never a token in the browser.
import { useQuery } from '@tanstack/react-query'
import { request, requestVoid } from '@/lib/net/client'
import { isApiError } from '@/lib/net/errors'
import { obj, str, type Parser } from '@/lib/net/parse'

export interface Admin {
  id: string
  username: string
  role: string
}

export const parseAdmin: Parser<Admin> = obj({ id: str, username: str, role: str })

export const SESSION_KEY = ['auth', 'me'] as const

export const fetchSession = () => request('/api/auth/me', parseAdmin)

/** A 401 is "not signed in", an answer. Anything else is "do not know": it does not sign out. */
export const isSignedOut = (err: unknown) => isApiError(err) && err.status === 401

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: (count, err) => !isSignedOut(err) && count < 2,
  })
}

const LOGOUT_TIMEOUT_MS = 3000

/**
 * A-038, F-2: the server ends the session, so a copy of the cookie stops working there.
 * Never throws and never waits long: the caller signs out here whatever happened, and
 * `false` makes the login screen say the server did not confirm.
 */
export async function signOutOnServer(): Promise<boolean> {
  try {
    await requestVoid('/api/auth/logout', { method: 'POST', timeoutMs: LOGOUT_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

export type LoginNotice = 'logoutUnconfirmed' | 'passwordChanged' | 'sessionExpired'

/** What the login screen reads from the navigation that brought the operator there. */
export function readLoginNotice(state: unknown): LoginNotice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null
  const { notice } = state
  return notice === 'logoutUnconfirmed' || notice === 'passwordChanged' || notice === 'sessionExpired' ? notice : null
}

/**
 * Where to go after the sign-in. Only an address inside the panel: `//host`, a scheme and a
 * backslash leave it, and a browser reads `/\host` as `//host`. An open redirect is forbidden.
 */
export function safeReturnPath(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return '/'
  const { from } = state
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.includes('\\') || from.startsWith('/login')) return '/'
  return [...from].some((ch) => ch.charCodeAt(0) < 32) ? '/' : from
}
