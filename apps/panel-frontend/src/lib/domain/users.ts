import type { RoutingPresetId } from '@iceslab/shared';
import { api, API_BASE_URL } from '@/lib/net/client';
import type { ProtocolName } from '@/lib/domain/protocols';

export type TrafficLimitStrategy = 'no_reset' | 'day' | 'week' | 'month' | 'rolling';

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

export type UserSort = 'username' | 'createdAt' | 'expireAt' | 'traffic';

export async function listUsers(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  /** Squad membership filter (Filters popover). */
  groupId?: string;
  /** Exact tag match (Filters popover), unlike `search` which is a substring. */
  tag?: string;
  /**
   * Routing-preset override filter. A preset id pins to that preset, `any`
   * returns everyone carrying an override, `none` everyone inheriting from
   * squad or panel. An unknown id is a 400, not a silently unfiltered list.
   */
  routingPreset?: RoutingPresetId | 'any' | 'none';
  /** Server-side, because the list is paged: sorting one page would lie. */
  sort?: UserSort;
  order?: 'asc' | 'desc';
}): Promise<UsersListResponse> {
  const { data } = await api.get<UsersListResponse>('/api/users', { params });
  return data;
}

/** Distinct tags in use, to populate the Filters popover. */
export async function listUserTags(): Promise<{ tags: string[] }> {
  const { data } = await api.get<{ tags: string[] }>('/api/users/tags');
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
  /** What the client will show for this line: a host remark, or country plus
   *  node name. One node produces several of these, so it is a caption, never
   *  an identity. */
  label: string;
  /** The node this endpoint leaves from. The only sound key for joining an
   *  endpoint to node state: labels differ per line and would match nothing. */
  nodeId: string;
  host: string;
  port: number;
  uri: string;
}

export async function fetchUserEndpoints(id: string): Promise<{ endpoints: UserEndpoint[] }> {
  const { data } = await api.get<{ endpoints: UserEndpoint[] }>(`/api/users/${id}/endpoints`);
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
