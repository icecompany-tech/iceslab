import { api } from '@/lib/net/client';

export interface AuthStatusResponse {
  authentication: { password: { enabled: boolean } };
  registration: { enabled: boolean };
  /** Subscription origin + path prefix, the only source of the copy-paste
   *  subscription link (users/lib/subscriptionLink). The origin is the host
   *  the operator set in the panel, else the environment's (A-171). */
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

/**
 * A-038: the server ends the session (POST /api/auth/logout, no body, 2xx), so
 * the cookie and token stop working there, not only in this browser. Never
 * throws and never waits long: a network error or a slow server must not keep
 * the operator signed in on this screen, so the caller clears the session
 * after it whatever happened.
 */
export async function logout(timeoutMs = 3000): Promise<void> {
  try {
    await api.post('/api/auth/logout', undefined, { timeout: timeoutMs });
  } catch {
    // The local sign-out goes on; the server's answer is not said.
  }
}

/** A-039: the admin's own password. 204 ends every session of the admin,
 *  this one too; the caller signs out. Refusals are 400, 403 and 429, never
 *  401 (passwordRefusal). */
export async function changePassword(body: {
  currentPassword: string;
  newPassword: string;
  totpCode?: string;
}): Promise<void> {
  await api.put('/api/auth/password', body);
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
