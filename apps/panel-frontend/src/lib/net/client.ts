import axios, { type AxiosError } from 'axios';
import { useAuth } from '@/lib/auth/session';
import { queryClient } from '@/lib/net/queryClient';

// Same-origin by default in PRODUCTION builds: the frontend nginx (and the
// install's Caddy) reverse-proxy /api, /sub, /health to the backend, so a
// relative baseURL "just works" and survives a build that forgot to set
// VITE_API_BASE_URL. Only DEV falls back to the cross-origin localhost:3000
// (vite dev server on :5173 talking to the backend on :3000). An explicit
// VITE_API_BASE_URL (including the Dockerfile's empty string) always wins.
// Hardening: a prod build that defaulted to localhost:3000 made the SPA call
// the VIEWER's own machine, so login never reached the backend and no JWT was
// issued (surfaces to the operator as "jwt does not show" after sign-in).
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.PROD ? '' : 'http://localhost:3000');

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request when we have one.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 the token is bad/expired, clear the session AND drop the React
// Query cache so the next admin signing in on the same browser doesn't
// see the previous admin's user list / dashboard flash before refetch.
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAuth.getState().clearSession();
      queryClient.clear();
    }
    return Promise.reject(err);
  },
);

/**
 * F-P1 - extract a human-readable message from a failed request: the backend's
 * `{ message }` (Fastify error shape) when present, else the Error message,
 * else String(err). Use in mutation `onError` handlers so operators see e.g.
 * `Port 443 on node "xray" is already used by profile "xray"` instead of the
 * generic axios `Request failed with status code 409`.
 */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
