import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache list responses for 30s before going stale.
      staleTime: 30_000,
      retry: 1,
      // F2 - the live pages (dashboard, nodes, users) already refetch on an
      // interval; refetchOnWindowFocus on top fires a full backend storm on
      // every alt-tab (worst on the heavy /dashboard/overview recompute). Off
      // globally; the interval is the single source of freshness.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
