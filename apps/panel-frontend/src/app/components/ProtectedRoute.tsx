import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth/session';

/**
 * Gatekeeper for any route that requires a logged-in admin. Place above the
 * AppLayout so unauthenticated users hit /login regardless of which inner
 * page they typed in the URL.
 */
export function ProtectedRoute() {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}
