import type { RoutingPresetId } from '@iceslab/shared';
import { api } from '@/lib/net/client';

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

/** POST /api/api-tokens response, includes the plaintext token ONCE.
 *  Panel never shows it again after this. */
export interface CreatedApiToken extends ApiToken {
  /** Plaintext bearer token, e.g. `icp_AbC123...`. Copy it now. */
  token: string;
}

export async function listApiTokens(): Promise<{ tokens: ApiToken[] }> {
  const { data } = await api.get<{ tokens: ApiToken[] }>('/api/api-tokens');
  return data;
}

export async function createApiToken(input: {
  name: string;
  scopes?: string[];
}): Promise<CreatedApiToken> {
  const { data } = await api.post<CreatedApiToken>('/api/api-tokens', input);
  return data;
}

export async function deleteApiToken(id: string): Promise<void> {
  await api.delete(`/api/api-tokens/${id}`);
}

export interface PublicSettings {
  brandName?: string;
}

/** Full settings dump (admin-only). Includes subscription metadata
 *  (slice S1, Profile-Title / Update-Interval / Support-URL / Announce). */
export interface AdminSettings extends PublicSettings {
  subscriptionProfileTitle?: string | null;
  subscriptionUpdateIntervalHours?: number;
  subscriptionSupportUrl?: string | null;
  subscriptionAnnounceTemplate?: string | null;
  subscriptionRoutingPreset?: RoutingPresetId;
  /** TLS-fragment - split the ClientHello in the Xray JSON format so SNI-DPI
   *  cannot match the handshake. Xray JSON only. */
  subscriptionTlsFragment?: boolean;
  /** R3-b - raw custom xray routing rules. */
  subscriptionCustomRoutingRules?: Record<string, unknown>[] | null;
  /** R3 - operator-defined custom domain lists (direct/proxy/block). */
  subscriptionCustomDomainLists?: {
    direct?: string[];
    proxy?: string[];
    block?: string[];
  } | null;
}

export interface UpdateSettingsInput {
  brandName?: string;
  subscriptionProfileTitle?: string | null;
  subscriptionUpdateIntervalHours?: number;
  subscriptionSupportUrl?: string | null;
  subscriptionAnnounceTemplate?: string | null;
  subscriptionRoutingPreset?: RoutingPresetId;
  subscriptionTlsFragment?: boolean;
  subscriptionCustomRoutingRules?: Record<string, unknown>[] | null;
  subscriptionCustomDomainLists?: {
    direct?: string[];
    proxy?: string[];
    block?: string[];
  } | null;
  /** Subscription landing-page default language, mirrored from the panel's UI
   *  language (set by the LanguageSwitcher). The /sub page has its own RU/EN
   *  selector that overrides this per visitor. */
  defaultLocale?: 'ru' | 'en';
}

/** Fetch public-flagged settings, no auth required. Used by LoginPage so
 *  the brand title shows correctly before sign-in. */
export async function getPublicSettings(): Promise<PublicSettings> {
  const { data } = await api.get<PublicSettings>('/api/settings/public');
  return data;
}

/** Admin-only, full settings dump. */
export async function getSettings(): Promise<AdminSettings> {
  const { data } = await api.get<AdminSettings>('/api/settings');
  return data;
}

export async function updateSettings(
  input: UpdateSettingsInput,
): Promise<{ ok: boolean; updated: string[] }> {
  const { data } = await api.put<{ ok: boolean; updated: string[] }>(
    '/api/settings',
    input,
  );
  return data;
}

// ───── System / version (ROADMAP D1) ─────

export interface SystemVersion {
  /** Running panel version (backend package.json). */
  current: string;
  /** Latest GitHub release tag, or null when the check couldn't run
   *  (GitHub unreachable, or private repo without GITHUB_TOKEN). */
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  /** Stargazer count for the topbar chip, null when the check couldn't run. */
  stars: number | null;
  checkedAt: string | null;
}

export async function getSystemVersion(): Promise<SystemVersion> {
  const { data } = await api.get<SystemVersion>('/api/system/version');
  return data;
}
