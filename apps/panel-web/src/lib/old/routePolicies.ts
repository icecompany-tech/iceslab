import { api } from '@/lib/old/api';
import { listFieldKnown } from '@/lib/old/nodeFields';

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

/**
 * 400 ROUTE_POLICY_ENTRY_UNKNOWN (BACK 265e93e): записи, которые ни имя, ни
 * адрес, и правило по ним молча не сработало бы. `null`: отказ не этот. Вход
 * проверяется первым; нестроковые записи пропускаются.
 */
export function policyEntryUnknown(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; entries?: unknown };
  if (d.error !== 'ROUTE_POLICY_ENTRY_UNKNOWN' || !Array.isArray(d.entries)) return null;
  return d.entries.filter((e): e is string => typeof e === 'string');
}

/** Какие записи правила сервер не принял: пересечение, в порядке правила. */
export function unknownInMatch(match: readonly string[], unknown: readonly string[]): string[] {
  const bad = new Set(unknown);
  return match.filter((m) => bad.has(m));
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
 * /api/routing-presets (A-229, BACK-2): the list carries the three built-ins
 * (`builtIn: true`, read-only, refused with 403 on write) and the operator's
 * own presets, which are stored rows with full CRUD.
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
  input: Partial<RoutingPresetInput>,
): Promise<RoutingPreset> {
  const { data } = await api.put<RoutingPreset>(`/api/routing-presets/${id}`, input);
  return data;
}

export async function deleteRoutingPreset(id: string): Promise<void> {
  await api.delete(`/api/routing-presets/${id}`);
}

/**
 * A refused preset write, read by code (A-229, BACK-2). Null: not one of
 * these, the caller says the server's sentence. The input is checked first;
 * entries and holders that are not strings or named rows are skipped.
 *
 *   400 ROUTING_PRESET_ENTRY_UNKNOWN / ROUTING_PRESET_GEO_TAG_UNKNOWN {entries}
 *   403 ROUTING_PRESET_BUILT_IN
 *   404 NOT_FOUND (the preset went away)
 *   409 NAME_TAKEN {field: 'name'}
 *   409 ROUTING_PRESET_IN_USE {users, squads, userCount, squadCount}
 */
export type RoutingPresetRefusal =
  | { code: 'ROUTING_PRESET_ENTRY_UNKNOWN' | 'ROUTING_PRESET_GEO_TAG_UNKNOWN'; entries: string[] }
  | { code: 'ROUTING_PRESET_BUILT_IN' | 'NOT_FOUND' | 'NAME_TAKEN' }
  | {
      code: 'ROUTING_PRESET_IN_USE';
      users: string[];
      squads: string[];
      userCount: number;
      squadCount: number;
    };

const PRESET_STATUS: Record<string, number> = {
  ROUTING_PRESET_ENTRY_UNKNOWN: 400,
  ROUTING_PRESET_GEO_TAG_UNKNOWN: 400,
  ROUTING_PRESET_BUILT_IN: 403,
  NOT_FOUND: 404,
  NAME_TAKEN: 409,
  ROUTING_PRESET_IN_USE: 409,
};

export function routingPresetRefusal(err: unknown): RoutingPresetRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const code = d.error;
  if (typeof code !== 'string' || !Object.hasOwn(PRESET_STATUS, code) || PRESET_STATUS[code] !== status) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []);
  const named = (v: unknown, key: 'username' | 'name') =>
    Array.isArray(v)
      ? v.flatMap((e) => {
          const n = e && typeof e === 'object' ? (e as Record<string, unknown>)[key] : undefined;
          return typeof n === 'string' ? [n] : [];
        })
      : [];
  if (code === 'ROUTING_PRESET_ENTRY_UNKNOWN' || code === 'ROUTING_PRESET_GEO_TAG_UNKNOWN') {
    return { code, entries: strings(d.entries) };
  }
  if (code === 'ROUTING_PRESET_IN_USE') {
    const users = named(d.users, 'username');
    const squads = named(d.squads, 'name');
    // The counts are the whole truth (the lists are capped); a count missing
    // or below its list is read from the list, never as zero.
    const count = (v: unknown, floor: number) => (typeof v === 'number' && v >= floor ? v : floor);
    return { code, users, squads, userCount: count(d.userCount, users.length), squadCount: count(d.squadCount, squads.length) };
  }
  return { code: code as 'ROUTING_PRESET_BUILT_IN' | 'NOT_FOUND' | 'NAME_TAKEN' };
}
