import type { RoutingPresetId, XraySubprotocol } from '@iceslab/shared';
import { api } from '@/lib/net/client';
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
  /** First time this user was ever seen connected. null = never has been. */
  firstConnectedAt: string | null;
  /** The node behind the last connection. */
  lastConnectedNodeId: string | null;
  /**
   * The node's name, sent alongside the id on purpose: resolving five hundred
   * rows against a second request is the thing this field exists to avoid.
   *
   * null in TWO cases and they are not the same: the user has never connected,
   * or the node they last used has since been deleted. The id next door tells
   * them apart, so the column reads it before deciding what to print.
   */
  lastConnectedNodeName: string | null;
  subscriptionToken: string;
  subRevokedAt: string | null;
  hwidDeviceLimit: number | null;
  /** R3, per-user routing-preset override; null = inherit (squad -> global -> default). */
  routingPreset: RoutingPresetId | null;
  /** A-229, the operator's own preset instead of a built-in one, never both. Absent: a server older than own presets. */
  customRoutingPresetId?: string | null;
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
  /** A-229, an own preset by id; the server takes one of the two, never both. */
  customRoutingPresetId?: string | null;
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
  /** A-229, an own preset by id: a value clears the built-in on the server, null clears only this side. */
  customRoutingPresetId?: string | null;
  enabledProtocols?: ProtocolName[];
  /** Slice 26, replaces the full squad set when provided. */
  groupIds?: string[];
}

export type UserSort =
  | 'username'
  | 'createdAt'
  | 'expireAt'
  | 'traffic'
  | 'lastOnline'
  | 'firstConnected'
  | 'lifetimeTraffic';

/**
 * Everything GET /api/users can actually narrow by.
 *
 * Exactly the list the API answers to and nothing beyond it: a header filter
 * with no server behind it looks interactive, returns the whole list, and
 * teaches the operator to distrust the ones that do work. `usedPct` is the
 * notable absence, and it stays absent rather than being faked client-side on
 * one page of a paged list.
 */
export interface UserFilters {
  /** A node id, or `none` for "has never connected anywhere". */
  nodeId?: string | 'none';
  online?: 'online' | 'offline' | 'never';
  expiresBefore?: string;
  expiresAfter?: string;
  /**
   * Seven of these read like yes/no questions and NONE of them take a boolean.
   * Each carries its own pair of words, and the pairs differ: `set` means "has
   * a device limit" under deviceLimit and "has an email" under email, while
   * the opposite of it is `unset` in one and `none` in the other. Mirrored
   * from users.schemas.ts literally rather than normalised into booleans here,
   * because a value this side invented comes back 400 and the screen would
   * have no way to know which of the seven it got wrong.
   */
  hasExpiry?: 'yes' | 'no';
  trafficLimit?: 'limited' | 'unlimited';
  usedOver?: number;
  usedUnder?: number;
  /** A-148 (e5d4d75c): `set` a limit of one or more, `unlimited` the explicit
   *  no-limit (0), `unset` none of the user's own (as the squads say). */
  deviceLimit?: 'set' | 'unlimited' | 'unset';
  telegram?: 'linked' | 'none';
  email?: 'set' | 'none';
  revoked?: 'yes' | 'no';
  hasTag?: 'yes' | 'no';
  createdBefore?: string;
  createdAfter?: string;
  firstConnectedBefore?: string;
  firstConnectedAfter?: string;
}

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
} & UserFilters): Promise<UsersListResponse> {
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

/** A-053: new keys for every protocol of the user (POST
 *  /api/users/:id/reissue-credentials, no body). Every config and the link
 *  handed out before stop working; the answer's shape is not read, the screen
 *  reads the user again (getUser). */
export async function reissueUserCredentials(id: string): Promise<void> {
  await api.post(`/api/users/${id}/reissue-credentials`);
}

/** One user as the server has it now (GET /api/users/:id). Checked before it
 *  is taken: an answer that is not this user is null, never a half user. */
export async function getUser(id: string): Promise<User | null> {
  const { data } = await api.get<unknown>(`/api/users/${id}`);
  return data && typeof data === 'object' && (data as { id?: unknown }).id === id ? (data as User) : null;
}

/** Zero used traffic + lift a traffic limit (period-billing top-up). */
export async function resetUserTraffic(id: string): Promise<User> {
  const { data } = await api.post<User>(`/api/users/${id}/reset-traffic`);
  return data;
}

// ───── Per-user subscription endpoints (admin view) ─────

export interface UserEndpoint {
  protocol: string;
  /** xray endpoints only: which of the xray subprotocols the line speaks.
   *  Absent on every other protocol, and on a server older than the key. */
  subprotocol?: XraySubprotocol;
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

/** A preset as the delivery endpoint names it: a built-in key or an own one. */
export interface PresetRef {
  builtIn: boolean;
  id: string;
  name: string;
}

/** Which preset this user is served and where it comes from (A-229). */
export interface DeliveryRouting {
  effective: PresetRef;
  user: PresetRef | null;
  squad: PresetRef | null;
  squadConflict: boolean;
}

/** GET /api/users/:id/delivery. Raw: `deliveryRouting` reads it. */
export async function getUserDelivery(id: string): Promise<unknown> {
  const { data } = await api.get<unknown>(`/api/users/${id}/delivery`);
  return data;
}

function presetRef(v: unknown): PresetRef | null {
  if (!v || typeof v !== 'object') return null;
  const { builtIn, id, name } = v as Record<string, unknown>;
  return typeof builtIn === 'boolean' && typeof id === 'string' && typeof name === 'string' ? { builtIn, id, name } : null;
}

/**
 * The routing of the delivery answer, with the operator's own presets in it
 * (`effectivePreset`, `userPreset`, `squadPreset`). The older fields speak in
 * built-in keys only: with an own preset `user` is null while the user does
 * hold one, so they are not read here. A server without the three fields, or
 * with one malformed, is null: the card says it does not know rather than
 * «no preset». The input is checked first.
 */
export function deliveryRouting(data: unknown): DeliveryRouting | null {
  if (!data || typeof data !== 'object') return null;
  const routing = (data as { routing?: unknown }).routing;
  if (!routing || typeof routing !== 'object') return null;
  const r = routing as Record<string, unknown>;
  const effective = presetRef(r.effectivePreset);
  if (!effective || !('userPreset' in r) || !('squadPreset' in r)) return null;
  const user = r.userPreset === null ? null : presetRef(r.userPreset);
  const squad = r.squadPreset === null ? null : presetRef(r.squadPreset);
  if ((r.userPreset !== null && !user) || (r.squadPreset !== null && !squad)) return null;
  return { effective, user, squad, squadConflict: r.squadConflict === true };
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
