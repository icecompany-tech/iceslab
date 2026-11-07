import { QueryCache, QueryClient } from '@tanstack/react-query'
import { SESSION_KEY } from '@/lib/auth/session'
import { isApiError } from '@/lib/net/errors'

const isRefusal = (err: unknown) => isApiError(err) && err.status >= 400 && err.status < 500

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // The session ended on the server: any request can be the first to learn it. The
      // guard reads the session again and goes to the sign-in on its 401.
      onError: (err, query) => {
        if (isApiError(err) && err.status === 401 && query.queryKey[0] !== SESSION_KEY[0]) {
          void client.invalidateQueries({ queryKey: SESSION_KEY })
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, err) => !isRefusal(err) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
  return client
}
