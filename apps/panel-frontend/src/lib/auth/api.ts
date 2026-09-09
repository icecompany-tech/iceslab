import { api } from '@/lib/net/client';

export interface AuthStatusResponse {
  authentication: { password: { enabled: boolean } };
  registration: { enabled: boolean };
  /** Panel public URL + subscription path prefix, used by the SPA to
   *  show admins the FULL copy-paste subscription URL on the user form,
   *  rather than just the path. Both come from backend env. */
  panel?: {
    publicUrl: string;
    subscriptionPathPrefix: string;
  };
}

export interface LoginResponse {
  admin: { id: string; username: string; role: string; createdAt: string; updatedAt: string };
  token: string;
}

export interface RegisterResponse {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const { data } = await api.get<AuthStatusResponse>('/api/auth/status');
  return data;
}

export async function login(
  username: string,
  password: string,
  totpCode?: string,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/api/auth/login', {
    username,
    password,
    ...(totpCode ? { totpCode } : {}),
  });
  return data;
}

// ───── K8: 2FA (TOTP) ─────

export interface TotpStatus {
  enabled: boolean;
}
export interface TotpSetup {
  secret: string;
  uri: string;
}

export async function get2faStatus(): Promise<TotpStatus> {
  const { data } = await api.get<TotpStatus>('/api/auth/2fa/status');
  return data;
}
export async function setup2fa(): Promise<TotpSetup> {
  const { data } = await api.post<TotpSetup>('/api/auth/2fa/setup');
  return data;
}
export async function enable2fa(code: string): Promise<void> {
  await api.post('/api/auth/2fa/enable', { code });
}
export async function disable2fa(code: string): Promise<void> {
  await api.post('/api/auth/2fa/disable', { code });
}

export async function register(username: string, password: string): Promise<RegisterResponse> {
  const { data } = await api.post<RegisterResponse>('/api/auth/register', { username, password });
  return data;
}
