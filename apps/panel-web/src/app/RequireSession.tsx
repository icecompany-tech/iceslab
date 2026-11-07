import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isSignedOut, useSession } from '@/lib/auth/session'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'

const DICT = {
  ru: { checking: 'Проверяем вход', failed: 'Не удалось проверить вход', retry: 'Повторить' },
  en: { checking: 'Checking the session', failed: 'Could not check the session', retry: 'Retry' },
}

/**
 * The server says who is signed in (F-14). Only its 401 sends to the sign-in: a server
 * that did not answer is "do not know", and it does not end anyone's work (F-K1).
 */
export function RequireSession() {
  const session = useSession()
  const location = useLocation()
  const words = useDict(DICT)
  const { locale } = useLocale()

  // First: after a 401 on a second read the old admin still sits in the cache.
  if (isSignedOut(session.error)) {
    const state = { from: `${location.pathname}${location.search}`, ...(session.data ? { notice: 'sessionExpired' } : {}) }
    return <Navigate to="/login" replace state={state} />
  }
  if (session.data) return <Outlet />
  if (session.isPending) return <QueryLoading label={words.checking} />
  return <QueryFailed title={words.failed} body={failureText(session.error, locale)} retryLabel={words.retry} onRetry={() => void session.refetch()} />
}
