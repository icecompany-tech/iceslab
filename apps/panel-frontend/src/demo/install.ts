/**
 * Bootstraps the read-only demo: swaps the axios transport for the fixture
 * adapter and auto-logs-in a demo admin so ProtectedRoute passes and the
 * visitor lands straight on the dashboard (no login screen). Called from
 * main.tsx behind `DEMO_MODE`, via a dynamic import, so none of this (nor the
 * fixtures) is bundled into the production panel.
 */
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../stores/auth';
import { demoAdapter } from './adapter';

export function installDemoMode(): void {
  // All requests resolve from local fixtures - zero network.
  api.defaults.adapter = demoAdapter;

  // Auto-login: seed the Zustand auth store with a demo admin + token. The
  // axios request interceptor will attach this token, and ProtectedRoute sees
  // a token so it renders the app instead of redirecting to /login.
  useAuth.setState({
    token: 'demo-token',
    admin: { id: 'demo-admin', username: 'admin', role: 'admin' },
  });

  // The fixture adapter never errors, so disable retries; data is static, so
  // skip refetch churn.
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  });
}
