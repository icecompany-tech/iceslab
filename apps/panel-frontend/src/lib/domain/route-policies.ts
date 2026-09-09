import { api } from '@/lib/net/client';

/** Stable, well-known UUID of the system "All" squad. Mirrored from
 *  apps/panel-backend/src/modules/squads/squads.constants.ts, UI uses it
 *  to render the row as read-only (rename/delete is rejected backend-side). */
export const ALL_SQUAD_ID = '00000000-0000-0000-0000-000000000001';

/**
 * What a route rule does with the traffic it matched.
 *   block  - dropped on the node, never leaves
 *   direct - straight out of the node's own IP
 *   warp   - out through the node's WARP egress (needs warpEnabled on the node)
 *   proxy  - on through the rest of the chain, the default door
 */
export type RouteAction = 'block' | 'direct' | 'warp' | 'proxy';

/** One rule of a policy. Order matters: first match wins. */
export interface RouteRule {
  id: string;
  /** Matcher tokens (`geosite:google`, `geoip:private`, `port:25`, ...). */
  match: string[];
  action: RouteAction;
  /** Operator's own note. Never used for matching. */
  note: string;
}

/** A4 ad-split, a named route-policy (extra, ordinal >= 1) grantable to squads. */
export interface RoutePolicy {
  id: string;
  name: string;
  ordinal: number;
  /**
   * The ordered rule list. The API does not ship it yet: today the list
   * endpoint answers with the two flat domain arrays below, and the panel
   * derives a rule list from them. Once the backend stores rules this becomes
   * the source of truth and the two arrays can go.
   */
  rules?: RouteRule[];
  directDomains: string[];
  blockDomains: string[];
}

export async function listRoutePolicies(): Promise<{ policies: RoutePolicy[] }> {
  const { data } = await api.get<{ policies: RoutePolicy[] }>('/api/route-policies');
  return data;
}

/**
 * What the API stores: a name and two flat domain lists. The editor works in an
 * ordered rule list, which is the shape an operator thinks in, so it folds the
 * rules down on save. `ordinal` is never sent: the band is the API's to assign
 * and, once assigned, cannot move at all.
 */
export interface RoutePolicyInput {
  name: string;
  directDomains: string[];
  blockDomains: string[];
}

/** Rules to the two lists the API keeps. `proxy` and `warp` have nowhere to go
 *  in a policy: it only ever answers "around the tunnel" or "nowhere". */
export function toPolicyInput(name: string, rules: Pick<RouteRule, 'match' | 'action'>[]): RoutePolicyInput {
  const pick = (action: RouteAction) =>
    rules.filter((r) => r.action === action).flatMap((r) => r.match.filter(Boolean));
  return { name, directDomains: pick('direct'), blockDomains: pick('block') };
}

/**
 * Whether the two write surfaces below exist yet. Policy writes shipped on
 * 2026-07-30; presets are still list-only, so their controls stay disabled and
 * say why rather than offering a button that answers 404.
 */
export const ROUTE_POLICY_WRITES_LIVE = true;
export const ROUTING_PRESET_WRITES_LIVE = false;

/**
 * Policy writes. Saving reaches the fleet on its own: the API re-pushes the
 * config to every enabled cascade entry, so there is no separate apply step.
 */
export async function createRoutePolicy(input: RoutePolicyInput): Promise<RoutePolicy> {
  const { data } = await api.post<RoutePolicy>('/api/route-policies', input);
  return data;
}

export async function updateRoutePolicy(id: string, input: RoutePolicyInput): Promise<RoutePolicy> {
  const { data } = await api.put<RoutePolicy>(`/api/route-policies/${id}`, input);
  return data;
}

/** A name or a band collided. The text says which, because the fix differs:
 *  rename, or let the API pick the band. */
export function policyConflict(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
  if (res?.status !== 409 && res?.status !== 400) return null;
  return res.data?.message ?? null;
}

export async function deleteRoutePolicy(id: string): Promise<void> {
  await api.delete(`/api/route-policies/${id}`);
}

/**
 * A routing preset: the rule set written into the client's own config.
 *
 * NOT LIVE either. Today a preset is one of three ids in `ROUTING_PRESET_IDS`
 * whose rules are compiled into the subscription builder, so there is nothing
 * to list, create or edit. This is the shape the editor is written against:
 * the three built-ins come back with `builtIn: true` and stay read-only, and
 * an operator's own presets are ordinary rows.
 *
 * A device can only bypass, block or tunnel. WARP is a node egress and has no
 * meaning here, which is why `RouteAction` is narrowed at the call site.
 */
export interface RoutingPreset {
  id: string;
  name: string;
  builtIn: boolean;
  rules: RouteRule[];
}

export interface RoutingPresetInput {
  name: string;
  rules: Omit<RouteRule, 'id'>[];
}

export async function listRoutingPresets(): Promise<{ presets: RoutingPreset[] }> {
  const { data } = await api.get<{ presets: RoutingPreset[] }>('/api/routing-presets');
  return data;
}

export async function createRoutingPreset(input: RoutingPresetInput): Promise<RoutingPreset> {
  const { data } = await api.post<RoutingPreset>('/api/routing-presets', input);
  return data;
}

export async function updateRoutingPreset(
  id: string,
  input: RoutingPresetInput,
): Promise<RoutingPreset> {
  const { data } = await api.put<RoutingPreset>(`/api/routing-presets/${id}`, input);
  return data;
}

export async function deleteRoutingPreset(id: string): Promise<void> {
  await api.delete(`/api/routing-presets/${id}`);
}
