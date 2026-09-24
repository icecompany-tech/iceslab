import { api } from '@/lib/net/client';
import { listFieldKnown } from '@/lib/domain/nodeFields';

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
 * Whether the preset write surface exists yet. It does not: there is no
 * /api/routing-presets route on the backend AT ALL, not even a GET, so the
 * controls stay disabled and say why rather than offering a button that
 * answers 404.
 *
 * The policy flag that used to stand beside this one is gone. Policy writes
 * shipped on 2026-07-30, the constant stayed `true` for six weeks, and the
 * banner it guarded went on telling operators the endpoints were missing. A
 * flag that cannot be false is not a guard, it is a thing to forget.
 */
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
 * 409 ROUTE_POLICY_IN_USE (Ф9.3, 794441c): политика стоит входом у каскадов, и
 * удалить её нельзя, пока там её не снимут. Вход проверяется первым; `null`
 * значит «отказ не этот». Записи без имени пропускаются.
 */
export function routePolicyInUse(err: unknown): { cascades: { id: string; name: string }[] } | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 409 || !data || typeof data !== 'object') return null;
  const d = data as { error?: unknown; cascades?: unknown };
  if (d.error !== 'ROUTE_POLICY_IN_USE') return null;
  const cascades = Array.isArray(d.cascades)
    ? d.cascades.flatMap((c) => {
        if (!c || typeof c !== 'object') return [];
        const { id, name } = c as { id?: unknown; name?: unknown };
        return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
      })
    : [];
  return { cascades };
}

/**
 * Каскады, у которых эта политика стоит входом, по факту списка каскадов (у
 * route-политики своего счётчика нет). Что сервер поле знает, первым говорит
 * `fields` конверта (CASCADE_DTO_FIELDS): тогда каскад без ключа читается как
 * «не задана». Без `fields` (сервер старше) правило прежнее: `null`, если у
 * кого-то из каскадов нет ключа `entryPolicy`, и экран не запрещает заранее, а
 * полагается на 409. Списка ещё нет: тоже `null`. Неполный факт фактом не
 * считается.
 */
export function policyEntryOf(
  policyId: string,
  cascades: { name: string; entryPolicy?: { id: string } | null }[] | undefined,
  fields?: unknown,
): string[] | null {
  if (!cascades) return null;
  const listed = listFieldKnown(fields, [], 'entryPolicy');
  if (!listed && cascades.some((c) => c.entryPolicy === undefined)) return null;
  return cascades.filter((c) => c.entryPolicy?.id === policyId).map((c) => c.name);
}

/**
 * A routing preset: the rule set written into the client's own config.
 *
 * ⚠ NOTHING is behind this on the backend. Not the writes, not the list: there
 * is no /api/routing-presets route at all, so the four calls below answer 404
 * to the last one. The screen does not depend on them, it reads the three ids
 * out of `devicePresets.ts`, and the list call is made once with `retry: false`
 * precisely so it can lose.
 *
 * Kept, not deleted, because this is the shape the editor is already written
 * against and the call sites are behind ROUTING_PRESET_WRITES_LIVE. The line
 * that used to stand here said «presets are still list-only», which was one
 * word away from the truth and would have let the next reader assume a GET
 * exists.
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
