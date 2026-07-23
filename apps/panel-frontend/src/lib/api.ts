import axios, { type AxiosError } from 'axios';
import type {
  RoutingPresetId,
  RecipeRegistryResponse,
  RecipeSource,
  RecipeSourceInput,
  RecipeImportResponse,
} from '@iceslab/shared';
import { useAuth } from '../stores/auth';
import { queryClient } from './queryClient';

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

// ───── Typed helpers for the endpoints we know about ─────

/**
 * Transport-recipe registry (community recipes pulled from GitHub). Best
 * effort: the backend returns `stale: true` plus the last-good or empty set
 * on failure, never an error, so the RecipePicker falls back to built-ins.
 */
export async function getRecipeRegistry(params?: {
  protocol?: string;
  region?: string;
}): Promise<RecipeRegistryResponse> {
  const { data } = await api.get<RecipeRegistryResponse>(
    '/api/recipes/registry',
    { params },
  );
  return data;
}

// Recipe sources (bring your own GitHub): operator-managed list the registry
// merges from. The default (curated) source is seeded server-side.
export async function getRecipeSources(): Promise<{ sources: RecipeSource[] }> {
  const { data } = await api.get<{ sources: RecipeSource[] }>('/api/recipes/sources');
  return data;
}

export async function addRecipeSource(input: RecipeSourceInput): Promise<RecipeSource> {
  const { data } = await api.post<RecipeSource>('/api/recipes/sources', input);
  return data;
}

export async function updateRecipeSource(
  id: string,
  patch: Partial<RecipeSourceInput>,
): Promise<RecipeSource> {
  const { data } = await api.patch<RecipeSource>(`/api/recipes/sources/${id}`, patch);
  return data;
}

export async function deleteRecipeSource(id: string): Promise<void> {
  await api.delete(`/api/recipes/sources/${id}`);
}

/** Ad-hoc import: validate recipes from a one-off URL or pasted JSON. */
export async function importRecipes(body: {
  url?: string;
  json?: string;
}): Promise<RecipeImportResponse> {
  const { data } = await api.post<RecipeImportResponse>('/api/recipes/import', body);
  return data;
}

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

// ───── Users ─────

export type TrafficLimitStrategy = 'no_reset' | 'day' | 'week' | 'month' | 'rolling';

export type ProtocolName =
  | 'hysteria'
  | 'xray'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru'
  | 'tuic'
  | 'anytls'
  | 'shadowtls';

export type ShadowsocksMethod =
  | '2022-blake3-aes-128-gcm'
  | '2022-blake3-aes-256-gcm'
  | '2022-blake3-chacha20-poly1305'
  | 'chacha20-ietf-poly1305'
  | 'aes-256-gcm'
  | 'aes-128-gcm';

export interface ShadowsocksInboundConfig {
  method: ShadowsocksMethod;
}

export interface MtprotoInboundConfig {
  domain: string;
}

export interface MieruInboundConfig {
  mtu: number;
}

export interface User {
  id: string;
  shortId: string;
  username: string;
  status: string;
  expireAt: string | null;
  trafficLimitBytes: number | null;
  trafficUsedBytes: number;
  lifetimeTrafficBytes: number;
  trafficLimitStrategy: TrafficLimitStrategy;
  lastTrafficResetAt: string | null;
  lastOnlineAt: string | null;
  subscriptionToken: string;
  subRevokedAt: string | null;
  hwidDeviceLimit: number | null;
  /** R3, per-user routing-preset override; null = inherit (squad -> global -> default). */
  routingPreset: RoutingPresetId | null;
  description: string | null;
  tag: string | null;
  telegramId: string | null;
  email: string | null;
  enabledProtocols: ProtocolName[];
  /** Slice 26, squads the user belongs to. Always includes ALL_SQUAD_ID. */
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersListResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateUserInput {
  username: string;
  /** Optional: import an existing subscription token (migration cut-over).
   *  URL-safe, <=64 chars. Omit to let the backend mint a fresh one. */
  subscriptionToken?: string;
  expireDays?: number | null;
  trafficLimitGb?: number | null;
  trafficLimitStrategy?: TrafficLimitStrategy;
  description?: string | null;
  tag?: string | null;
  email?: string | null;
  telegramId?: string | null;
  hwidDeviceLimit?: number | null;
  /** R3, per-user routing-preset override; null = inherit. */
  routingPreset?: RoutingPresetId | null;
  enabledProtocols?: ProtocolName[];
  /** Slice 26, squad membership. Empty/undefined → backend auto-adds to All. */
  groupIds?: string[];
}

export interface UpdateUserInput {
  status?: 'active' | 'disabled';
  trafficLimitGb?: number | null;
  trafficLimitStrategy?: TrafficLimitStrategy;
  expireAt?: string | null;
  description?: string | null;
  tag?: string | null;
  email?: string | null;
  telegramId?: string | null;
  hwidDeviceLimit?: number | null;
  /** R3, per-user routing-preset override; null clears it (back to inherit). */
  routingPreset?: RoutingPresetId | null;
  enabledProtocols?: ProtocolName[];
  /** Slice 26, replaces the full squad set when provided. */
  groupIds?: string[];
}

export async function listUsers(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}): Promise<UsersListResponse> {
  const { data } = await api.get<UsersListResponse>('/api/users', { params });
  return data;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const { data } = await api.post<User>('/api/users', input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  const { data } = await api.put<User>(`/api/users/${id}`, input);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/api/users/${id}`);
}

/** Kill the user's current subscription link (leaked/abused). /sub then 403s
 *  until the link is rotated. */
export async function revokeUserSubscription(id: string): Promise<User> {
  const { data } = await api.post<User>(`/api/users/${id}/revoke`);
  return data;
}

/** Issue a fresh subscription token: the old link stops resolving and any
 *  prior revoke is cleared so the new link works. */
export async function rotateUserSubscription(id: string): Promise<User> {
  const { data } = await api.post<User>(`/api/users/${id}/rotate-subscription`);
  return data;
}

/** Zero used traffic + lift a traffic limit (period-billing top-up). */
export async function resetUserTraffic(id: string): Promise<User> {
  const { data } = await api.post<User>(`/api/users/${id}/reset-traffic`);
  return data;
}

/** Helper to build a copy-pasteable subscription URL for a user.
 *  Pass `panel` (from /api/auth/status) to substitute the configured
 *  public URL + path prefix; falls back to API_BASE_URL + /sub when
 *  the metadata isn't available (dev / status endpoint failed). */
export function subscriptionUrl(
  token: string,
  panel?: { publicUrl: string; subscriptionPathPrefix: string },
): string {
  if (panel?.publicUrl) {
    return `${panel.publicUrl}${panel.subscriptionPathPrefix}/${token}`;
  }
  return `${API_BASE_URL}/sub/${token}`;
}

// ───── Per-user subscription endpoints (admin view) ─────

export interface UserEndpoint {
  protocol: string;
  nodeName: string;
  host: string;
  port: number;
  uri: string;
}

export async function fetchUserEndpoints(id: string): Promise<{ endpoints: UserEndpoint[] }> {
  const { data } = await api.get<{ endpoints: UserEndpoint[] }>(`/api/users/${id}/endpoints`);
  return data;
}

// ───── Nodes ─────

export type NodeProtocol =
  | 'xray'
  | 'hysteria'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru'
  | 'tuic'
  | 'anytls'
  | 'shadowtls';

// G (Zashchita / hardening) - probe-resistance toggles persisted to
// nodes.hardening. Each maps 1:1 to an install-iceslab-node.sh flag. NULL on a
// node = no hardening (install command is unchanged).
export interface NodeHardening {
  ufwLockdown?: boolean;
  fail2ban?: boolean;
  realisticFallback?: boolean;
  sshAllowlist?: string[];
}

export interface Node {
  id: string;
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  consumptionMultiplier: string;
  // Slice 27.5
  regionId: string | null;
  maxUsers: number | null;
  // B3/G - FQDN for REALITY self-steal serverName + future ACME.
  domain: string | null;
  // G - Zashchita hardening blob.
  hardening?: NodeHardening | null;
  // WARP egress on/off (per-node). Creds are never sent to the client.
  warpEnabled: boolean;
  // Engine-choice: sing-box engine installed alongside the native core.
  singboxEngine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapInfo {
  /** Single-use token (URL-safe, ~32 chars). Survives the 4 KB TTY paste limit. */
  token: string;
  /** ISO timestamp when the token stops being redeemable. */
  expiresAt: string;
  /** Pre-rendered single-line install command, ready to copy-paste on the node. */
  command: string;
}

/** The create response carries the one-time payload + a bootstrap token. */
export interface NodeWithPayload extends Node {
  payload: string;
  bootstrap: BootstrapInfo;
}

/**
 * Register a free Cloudflare WARP device for this node and enable per-node WARP
 * egress (the node's xray inbound starts routing out through WARP on next push).
 * The Cloudflare call happens server-side; creds stay in the panel DB.
 */
export async function registerNodeWarp(id: string): Promise<Node> {
  const { data } = await api.post<Node>(`/api/nodes/${id}/warp/register`);
  return data;
}

/** Turn off WARP egress for this node (keeps creds for instant re-enable). */
export async function disableNodeWarp(id: string): Promise<Node> {
  const { data } = await api.delete<Node>(`/api/nodes/${id}/warp`);
  return data;
}

export async function refreshNodeBootstrap(id: string): Promise<BootstrapInfo> {
  const { data } = await api.post<BootstrapInfo>(`/api/nodes/${id}/bootstrap`);
  return data;
}

export interface NodesListResponse {
  nodes: Node[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateNodeInput {
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
  regionId?: string | null;
  maxUsers?: number | null;
  domain?: string | null;
  hardening?: NodeHardening | null;
  singboxEngine?: boolean;
}

export interface UpdateNodeInput {
  name?: string;
  address?: string;
  protocol?: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
  regionId?: string | null;
  maxUsers?: number | null;
  domain?: string | null;
  hardening?: NodeHardening | null;
  singboxEngine?: boolean;
}

export async function listNodes(params?: {
  page?: number;
  limit?: number;
  status?: string;
  regionId?: string;
}): Promise<NodesListResponse> {
  const { data } = await api.get<NodesListResponse>('/api/nodes', { params });
  return data;
}

// ───── Regions (slice 27.5) ─────

export async function listRegions(): Promise<{ regions: Region[] }> {
  const { data } = await api.get<{ regions: Region[] }>('/api/regions');
  return data;
}

export async function createRegion(input: { name: string; code: string }): Promise<Region> {
  const { data } = await api.post<Region>('/api/regions', input);
  return data;
}

export async function updateRegion(
  id: string,
  input: { name?: string; code?: string },
): Promise<Region> {
  const { data } = await api.put<Region>(`/api/regions/${id}`, input);
  return data;
}

export async function deleteRegion(id: string): Promise<void> {
  await api.delete(`/api/regions/${id}`);
}

export async function createNode(input: CreateNodeInput): Promise<NodeWithPayload> {
  const { data } = await api.post<NodeWithPayload>('/api/nodes', input);
  return data;
}

export async function updateNode(id: string, input: UpdateNodeInput): Promise<Node> {
  const { data } = await api.put<Node>(`/api/nodes/${id}`, input);
  return data;
}

export async function deleteNode(id: string): Promise<void> {
  await api.delete(`/api/nodes/${id}`);
}

// ───── G4: node probe-exposure ─────

export interface PortExposureResult {
  /** false when the check could not run (ufw-less host, old/unreachable agent). */
  checked: boolean;
  managed?: boolean;
  expected?: string[];
  extras?: string[];
  note?: string;
}

export async function getNodeExposure(id: string): Promise<PortExposureResult> {
  const { data } = await api.get<PortExposureResult>(`/api/nodes/${id}/exposure`);
  return data;
}

// ───── Subscription Response Rules (SRR) ─────

export type SubscriptionFormat =
  | 'plain' | 'json' | 'clash' | 'singbox' | 'wgconf' | 'xrayjson' | 'xkeen'
  | 'outline' | 'surge' | 'quantumultx' | 'loon';

export interface SrrRule {
  id: string;
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSrrInput {
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
}

export interface UpdateSrrInput {
  name?: string;
  uaPattern?: string;
  format?: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
}

export interface TestSrrResponse {
  /** null when no rule matched. */
  format: SubscriptionFormat | null;
  userAgent: string;
}

export async function listSrrRules(): Promise<{ rules: SrrRule[] }> {
  const { data } = await api.get<{ rules: SrrRule[] }>('/api/srr');
  return data;
}

export async function createSrrRule(input: CreateSrrInput): Promise<SrrRule> {
  const { data } = await api.post<SrrRule>('/api/srr', input);
  return data;
}

export async function updateSrrRule(id: string, input: UpdateSrrInput): Promise<SrrRule> {
  const { data } = await api.put<SrrRule>(`/api/srr/${id}`, input);
  return data;
}

export async function deleteSrrRule(id: string): Promise<void> {
  await api.delete(`/api/srr/${id}`);
}

// ───── Inbounds ─────

export interface HysteriaInboundConfig {
  obfsPassword?: string;
  masqueradeUrl?: string;
  brutalUpMbps?: number;
  brutalDownMbps?: number;
}

export type XrayNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';

export interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
  flow?: string;
  fingerprint?: string;
  network?: XrayNetwork;
  path?: string;
  host?: string;
  serviceName?: string;
  /** Slice 24c part 3, `vless` (default) or `trojan` over the same REALITY
   *  stack. Empty/undefined → server falls back to vless. */
  subprotocol?: 'vless' | 'trojan';
  /** B3 advanced knobs. All optional, Zod-defaulted server-side. REALITY
   *  pair applies when security=reality, tlsRejectUnknownSni when
   *  security=tls, xhttp* when network=xhttp, grpcMultiMode when network=grpc. */
  realityXver?: 0 | 1 | 2;
  realityMaxTimeDiff?: number;
  /** G: throttle unverified REALITY fallback (probe) connections, bytes/sec; 0 = off. */
  realityLimitFallbackUploadBytesPerSec?: number;
  realityLimitFallbackDownloadBytesPerSec?: number;
  tlsRejectUnknownSni?: boolean;
  xhttpMode?: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
  xhttpPaddingBytes?: string;
  grpcMultiMode?: boolean;
  /** G1 - realistic fallback: real site URL the self-steal local TLS fallback
   *  reverse-proxies probe requests to. Empty = static landing page. */
  realityFallbackUpstream?: string;
}

export interface AmneziawgObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  /** v2.0 mimicry packets (hex). Optional, Zod defaults empty. */
  i1?: string;
  i2?: string;
  i3?: string;
  i4?: string;
  i5?: string;
}

export interface AmneziawgInboundConfig {
  subnet: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  obfuscation: AmneziawgObfuscation;
}

export interface NaiveInboundConfig {
  hostname: string;
  tlsEmail: string;
  masqueradeRoot: string;
}

export type InboundConfig =
  | HysteriaInboundConfig
  | XrayInboundConfig
  | AmneziawgInboundConfig
  | NaiveInboundConfig
  | ShadowsocksInboundConfig
  | MtprotoInboundConfig
  | MieruInboundConfig;

export interface Inbound {
  id: string;
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  /** Override of the public host emitted in client URIs. NULL → fall back
   *  to `node.address`. Slice 25, separates control-plane endpoint from
   *  client-facing FQDN. */
  publicHost: string | null;
  /** Override of the public port. NULL → use `port`. */
  publicPort: number | null;
  config: InboundConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInboundInput {
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  enabled?: boolean;
  publicHost?: string;
  publicPort?: number;
  config: InboundConfig;
}

export interface UpdateInboundInput {
  name?: string;
  port?: number;
  enabled?: boolean;
  /** `null` clears the override, `undefined` keeps the current value. */
  publicHost?: string | null;
  publicPort?: number | null;
  config?: InboundConfig;
}

export async function listInbounds(): Promise<{ inbounds: Inbound[] }> {
  const { data } = await api.get<{ inbounds: Inbound[] }>('/api/inbounds');
  return data;
}

export async function createInbound(input: CreateInboundInput): Promise<Inbound> {
  const { data } = await api.post<Inbound>('/api/inbounds', input);
  return data;
}

export async function updateInbound(id: string, input: UpdateInboundInput): Promise<Inbound> {
  const { data } = await api.put<Inbound>(`/api/inbounds/${id}`, input);
  return data;
}

export async function deleteInbound(id: string): Promise<void> {
  await api.delete(`/api/inbounds/${id}`);
}

export interface KeypairResponse {
  privateKey: string;
  publicKey: string;
}

/** Generate a fresh x25519 keypair for REALITY / AmneziaWG inbound.
 *  Same crypto, different alphabet: `xray` returns base64url (REALITY
 *  validator rejects standard base64), `amneziawg` returns standard base64. */
export async function generateInboundKeypair(
  protocol: 'xray' | 'amneziawg' = 'amneziawg',
): Promise<KeypairResponse> {
  const { data } = await api.post<KeypairResponse>(
    `/api/profiles/generate-keypair?protocol=${protocol}`,
  );
  return data;
}

export async function testSrrRule(userAgent: string): Promise<TestSrrResponse> {
  const { data } = await api.post<TestSrrResponse>('/api/srr/test', { userAgent });
  return data;
}

// ───── Squads (slice 26) ─────

/** Stable, well-known UUID of the system "All" squad. Mirrored from
 *  apps/panel-backend/src/modules/squads/squads.constants.ts, UI uses it
 *  to render the row as read-only (rename/delete is rejected backend-side). */
export const ALL_SQUAD_ID = '00000000-0000-0000-0000-000000000001';

export interface Squad {
  id: string;
  name: string;
  description: string | null;
  /** Slice 27, squad ACL is profile-level. Renamed from inboundIds. */
  profileIds: string[];
  /** R3-a, per-squad routing-preset override; null = inherit panel default. */
  routingPreset: RoutingPresetId | null;
  /** K7, per-squad HWID device-limit default; null = none. */
  hwidDeviceLimit: number | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSquadInput {
  name: string;
  description?: string | null;
  routingPreset?: RoutingPresetId | null;
  hwidDeviceLimit?: number | null;
  profileIds?: string[];
}

export interface UpdateSquadInput {
  name?: string;
  description?: string | null;
  routingPreset?: RoutingPresetId | null;
  hwidDeviceLimit?: number | null;
  /** Replaces the full profile set when provided. */
  profileIds?: string[];
}

export async function listSquads(): Promise<{ squads: Squad[] }> {
  const { data } = await api.get<{ squads: Squad[] }>('/api/squads');
  return data;
}

export async function createSquad(input: CreateSquadInput): Promise<Squad> {
  const { data } = await api.post<Squad>('/api/squads', input);
  return data;
}

export async function updateSquad(id: string, input: UpdateSquadInput): Promise<Squad> {
  const { data } = await api.put<Squad>(`/api/squads/${id}`, input);
  return data;
}

export async function deleteSquad(id: string): Promise<void> {
  await api.delete(`/api/squads/${id}`);
}

// ───── Cascades (multi-hop, Section C) ─────

export type CascadeProtocol =
  | 'xray' | 'hysteria' | 'amneziawg' | 'naive' | 'shadowsocks' | 'mtproto' | 'mieru';

/** 'chain' (sequential) or 'balancer' (one entry, N latency-balanced exits). */
export type CascadeMode = 'chain' | 'balancer';

export interface CascadeHop {
  id: string;
  nodeId: string;
  nodeName: string;
  position: number;
  entryProtocol: string | null;
  linkProtocol: string | null;
}

export interface Cascade {
  id: string;
  name: string;
  enabled: boolean;
  mode: CascadeMode;
  /** Hide the cascade's non-entry nodes from the raw subscription (default). */
  hideHopsFromSub: boolean;
  hops: CascadeHop[];
  createdAt: string;
  updatedAt: string;
}

export interface CascadeHopInput {
  nodeId: string;
  position: number;
  entryProtocol?: CascadeProtocol;
  linkProtocol?: CascadeProtocol;
}

export interface CreateCascadeInput {
  name: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops: CascadeHopInput[];
}

export interface UpdateCascadeInput {
  name?: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops?: CascadeHopInput[];
}

export async function listCascades(): Promise<{ cascades: Cascade[] }> {
  const { data } = await api.get<{ cascades: Cascade[] }>('/api/cascades');
  return data;
}

export async function createCascade(input: CreateCascadeInput): Promise<Cascade> {
  const { data } = await api.post<Cascade>('/api/cascades', input);
  return data;
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<Cascade> {
  const { data } = await api.put<Cascade>(`/api/cascades/${id}`, input);
  return data;
}

export interface CascadeHopStatus {
  nodeId: string;
  name: string;
  /** The node acknowledged an inbound push made after this cascade was saved. */
  applied: boolean;
  online: boolean;
}

export interface CascadeStatus {
  done: boolean;
  hops: CascadeHopStatus[];
}

/** Provisioning state of a cascade's hops, polled after a save. */
export async function getCascadeStatus(id: string): Promise<CascadeStatus> {
  const { data } = await api.get<CascadeStatus>(`/api/cascades/${id}/status`);
  return data;
}

export async function deleteCascade(id: string): Promise<void> {
  await api.delete(`/api/cascades/${id}`);
}

// ───── Profiles + Bindings (slice 27) ─────
//
// Replaces the per-node Inbound model. A Profile is a logical inbound
// template (shared across nodes), a Binding deploys it to a specific node
// with optional per-node overrides.

export type EngineName = 'xray' | 'hysteria' | 'singbox';

export interface Profile {
  id: string;
  name: string;
  protocol: ProtocolName;
  /** Proxy core that serves this profile. null = native core; 'singbox' = the
   *  sing-box engine (engine-choice). */
  engine: string | null;
  description: string | null;
  config: InboundConfig;
  enabled: boolean;
  bindingCount: number;
  /** Distinct users who can reach this profile via squad ACL. */
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Binding {
  id: string;
  profileId: string;
  nodeId: string;
  port: number;
  publicHost: string | null;
  publicPort: number | null;
  overrides: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  name: string;
  protocol: ProtocolName;
  description?: string | null;
  /** Engine-choice: null/omitted = native core, 'singbox' = sing-box. */
  engine?: EngineName | null;
  config: InboundConfig;
  enabled?: boolean;
}

export interface UpdateProfileInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  engine?: EngineName | null;
  config?: InboundConfig;
}

export interface CreateBindingInput {
  profileId: string;
  nodeId: string;
  port: number;
  publicHost?: string;
  publicPort?: number;
  overrides?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateBindingInput {
  port?: number;
  publicHost?: string | null;
  publicPort?: number | null;
  overrides?: Record<string, unknown> | null;
  enabled?: boolean;
}

export async function listProfiles(params?: {
  protocol?: ProtocolName;
}): Promise<{ profiles: Profile[] }> {
  const { data } = await api.get<{ profiles: Profile[] }>('/api/profiles', { params });
  return data;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const { data } = await api.post<Profile>('/api/profiles', input);
  return data;
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<Profile> {
  const { data } = await api.put<Profile>(`/api/profiles/${id}`, input);
  return data;
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/api/profiles/${id}`);
}

export async function listBindings(params?: {
  nodeId?: string;
  profileId?: string;
}): Promise<{ bindings: Binding[] }> {
  const { data } = await api.get<{ bindings: Binding[] }>('/api/bindings', { params });
  return data;
}

export async function createBinding(input: CreateBindingInput): Promise<Binding> {
  const { data } = await api.post<Binding>('/api/bindings', input);
  return data;
}

/** F-P1-b: next free listen port for a new binding on `nodeId` (skips ports
 *  already bound there). Pre-fills the deploy modal so it stops defaulting to
 *  443 and 409-ing on multi-protocol nodes. */
export async function getNextFreePort(nodeId: string): Promise<number> {
  const { data } = await api.get<{ port: number }>('/api/bindings/next-free-port', {
    params: { nodeId },
  });
  return data.port;
}

export async function updateBinding(id: string, input: UpdateBindingInput): Promise<Binding> {
  const { data } = await api.put<Binding>(`/api/bindings/${id}`, input);
  return data;
}

export async function deleteBinding(id: string): Promise<void> {
  await api.delete(`/api/bindings/${id}`);
}

// ───── Test-Connect (slice 31) ─────

export interface TestConnectResult {
  bindingId: string;
  hostId: string | null;
  hostRemark: string;
  protocol: string;
  nodeName: string;
  endpoint: string;
  port: number;
  probe: 'tcp' | 'tls' | 'skip';
  // K10: 'endpoint' = client-facing target; 'dest' = the REALITY masquerade
  // target the node borrows its TLS1.3 handshake from.
  kind: 'endpoint' | 'dest';
  sni?: string;
  ok: boolean;
  latencyMs?: number;
  certCn?: string;
  // TLS-only: negotiated version. REALITY needs the dest to speak TLSv1.3.
  tlsVersion?: string;
  // H1 (dest) - negotiated ALPN (e.g. "h2"); a CDN-grade dest speaks HTTP/2.
  alpn?: string;
  error?: string;
  notes?: string;
}

export async function testConnectProfile(profileId: string): Promise<{ results: TestConnectResult[] }> {
  const { data } = await api.post<{ results: TestConnectResult[] }>(
    `/api/profiles/${profileId}/test-connect`,
  );
  return data;
}

// ───── HWID devices (slice S2) ─────

export interface HwidDevice {
  id: string;
  userId: string;
  hwid: string;
  label: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function listUserDevices(userId: string): Promise<{ devices: HwidDevice[] }> {
  const { data } = await api.get<{ devices: HwidDevice[] }>(
    `/api/users/${userId}/hwid-devices`,
  );
  return data;
}

export async function deleteHwidDevice(id: string): Promise<void> {
  await api.delete(`/api/hwid-devices/${id}`);
}

// ───── Hosts (slice 30) ─────
//
// One Binding can fan out into N Hosts in subscriptions. Each Host is a
// distinct URL with overrides for SNI / fingerprint / path / host-header /
// ALPN / etc. on top of the binding's base config.

export type Fingerprint =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'ios'
  | 'android'
  | 'edge'
  | 'random';

export interface Host {
  id: string;
  bindingId: string;
  remark: string;
  priority: number;
  enabled: boolean;
  addressOverride: string | null;
  portOverride: number | null;
  sniOverride: string | null;
  hostHeaderOverride: string | null;
  pathOverride: string | null;
  fingerprintOverride: Fingerprint | null;
  alpn: string[];
  allowInsecure: boolean;
  securityLayer: 'default' | 'tls' | 'none';
  disableForFormats: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateHostInput {
  bindingId: string;
  remark?: string;
  priority?: number;
  enabled?: boolean;
  addressOverride?: string | null;
  portOverride?: number | null;
  sniOverride?: string | null;
  hostHeaderOverride?: string | null;
  pathOverride?: string | null;
  fingerprintOverride?: Fingerprint | null;
  alpn?: string[];
  allowInsecure?: boolean;
  securityLayer?: 'default' | 'tls' | 'none';
  disableForFormats?: string[];
}

export type UpdateHostInput = Partial<Omit<CreateHostInput, 'bindingId'>>;

export async function listHosts(params?: {
  bindingId?: string;
  profileId?: string;
  nodeId?: string;
}): Promise<{ hosts: Host[] }> {
  const { data } = await api.get<{ hosts: Host[] }>('/api/hosts', { params });
  return data;
}

export async function createHost(input: CreateHostInput): Promise<Host> {
  const { data } = await api.post<Host>('/api/hosts', input);
  return data;
}

export async function updateHost(id: string, input: UpdateHostInput): Promise<Host> {
  const { data } = await api.put<Host>(`/api/hosts/${id}`, input);
  return data;
}

export async function deleteHost(id: string): Promise<void> {
  await api.delete(`/api/hosts/${id}`);
}

export async function reorderHosts(hostIds: string[]): Promise<{ hosts: Host[] }> {
  const { data } = await api.put<{ hosts: Host[] }>('/api/hosts/reorder', {
    hostIds,
  });
  return data;
}

// ───── API tokens ─────

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

// ───── Dashboard ─────

export interface NodeHostMetrics {
  cpu: {
    usagePercent: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    cores: number;
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  uptimeSeconds: number;
  collectedAt: string;
}

export interface DashboardOverview {
  users: {
    total: number;
    byStatus: Record<string, number>;
    onlineNow: number;
    onlineToday: number;
    onlineThisWeek: number;
    neverOnline: number;
  };
  traffic: {
    todayBytes: number;
    yesterdayBytes: number;
    last7dBytes: number;
    last30dBytes: number;
    calendarMonthBytes: number;
    currentYearBytes: number;
    // K1 - prior-period totals for "vs previous" deltas.
    prev7dBytes: number;
    prev30dBytes: number;
    lastCalendarMonthBytes: number;
    lastYearBytes: number;
    last24hHourly: { hour: string; bytes: number }[];
  };
  system: {
    onlineNodeCount: number;
    totalNodeCount: number;
  };
  inventory: {
    profileCount: number;
    squadCount: number;
  };
  host: {
    cpu: {
      loadPercent: number | null;
      samplePercent: number;
      cores: number;
      loadavg: [number, number, number];
    };
    memory: { totalBytes: number; usedBytes: number; usedPercent: number };
    disk: {
      totalBytes: number;
      usedBytes: number;
      usedPercent: number;
      path: string;
    } | null;
    process: {
      rssBytes: number;
      heapUsedBytes: number;
      heapLimitBytes: number;
      uptimeSeconds: number;
    };
  };
  nodes: {
    id: string;
    name: string;
    address: string;
    protocol: string;
    status: string;
    countryCode: string | null;
    lastStatusChange: string | null;
    inboundCount: number;
    todayBytes: number;
    metrics: NodeHostMetrics | null;
  }[];
  byProtocol: {
    protocol: string;
    inboundCount: number;
    enabledUserCount: number;
  }[];
  topUsersToday: { id: string; username: string; bytes: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    userId: string;
    username: string | null;
    createdAt: string;
  }[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const { data } = await api.get<DashboardOverview>('/api/dashboard/overview');
  return data;
}

// ───── K1-b/c Insights (SRH + HWID inspectors) ─────

export interface Insights {
  windowDays: number;
  subRequests: {
    total: number;
    uniqueUsers: number;
    byClient: { client: string; count: number }[];
    byHourUtc: number[];
  };
  hwid: {
    totalDevices: number;
    usersWithDevices: number;
    avgDevicesPerUser: number;
    distribution: { bucket: string; users: number }[];
    atOrOverLimit: number;
  };
}

/** On-demand analytics over stored subscription-request + HWID data. `days`
 *  bounds the request-history window (HWID stats are point-in-time). */
export async function getInsights(days: number): Promise<Insights> {
  const { data } = await api.get<Insights>('/api/dashboard/insights', { params: { days } });
  return data;
}

// ───── Settings ─────

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
  checkedAt: string | null;
}

export async function getSystemVersion(): Promise<SystemVersion> {
  const { data } = await api.get<SystemVersion>('/api/system/version');
  return data;
}
