import { useQuery } from '@tanstack/react-query';
import { getDashboardOverview } from '@/lib/net/api';

/**
 * F1 - single source of the `/dashboard/overview` poll.
 *
 * Previously five call sites (AppLayout, DashboardPage, NodesPage, UsersPage,
 * NodeEditModal) each declared their own `refetchInterval` (30s / 15s / 10s /
 * none) against the SAME query key, so the effective cadence was an accidental
 * min-of-whatever-happened-to-be-mounted - a backend-load papercut.
 *
 * One hook, one interval. 30s matches the backend's 30s overview cache TTL:
 * polling faster only re-serves the same cached blob (no fresher data), so 30s
 * is both consistent AND the minimal-waste cadence. Tune it here, once.
 */
export function useOverview(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled: opts?.enabled ?? true,
  });
}
