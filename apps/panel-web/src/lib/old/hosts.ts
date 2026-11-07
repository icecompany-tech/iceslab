import { api } from '@/lib/old/api';
import type { Fingerprint } from '@/lib/old/protocols';

//
// One Binding can fan out into N Hosts in subscriptions. Each Host is a
// distinct URL with overrides for SNI / fingerprint / path / host-header /
// ALPN / etc. on top of the binding's base config.

export interface Host {
  id: string;
  bindingId: string;
  /**
   * Squads that hand this host out, and how many DISTINCT people that is.
   * Present on the list endpoint only.
   *
   * Counted server-side on purpose: one person can be in several squads, and
   * the squad list carries member counts rather than user ids, so there is
   * nothing here to deduplicate against. Adding them up read one person in two
   * squads as two people.
   */
  reach?: { squads: number; users: number };
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
  /**
   * When the link this host hands out last changed shape: address, port, SNI,
   * path, the profile behind it. NOT `updatedAt`, which also moves for edits
   * that leave the link identical (a remark, the priority), and a client
   * holding an unchanged link is not stale.
   */
  configChangedAt?: string;
  /**
   * Хост стоит на ноде, которая в каскаде НЕ вход, и пока каскад включён,
   * подписка его не выдаёт никому: клиенты заходят через вход каскада.
   *
   * Три значения: отсутствие ключа это «бэкенд старше поля», `null` это «не
   * скрыт», объект это «скрыт этим каскадом». Первые два одинаково молчат на
   * экране; разница нужна только тому, кто читает тип. В ответе reorder ключа
   * нет по контракту.
   */
  hiddenByCascade?: { cascadeId: string; cascadeName: string } | null;
  /**
   * A-236 step 6. The line a client app that understands it shows under the
   * server name (one line, up to HOST_SERVER_DESCRIPTION_MAX code points);
   * `null` = none. No key: a server older than step 6, which has not said.
   */
  serverDescription?: string | null;
  /**
   * The operator hid the host: no subscription hands it out, except a
   * template with includeHiddenHosts. Not `hiddenByCascade`, which is the
   * cascade's doing. No key: a server older than step 6, never read as «no».
   */
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 400 VALIDATION_ERROR at `serverDescription` (A-236 step 6): the server's
 * sentence from `issues[].message`, said at the field. The input is checked
 * first; any other refusal is not this one.
 */
export function serverDescriptionRefusal(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 400 || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.error !== 'VALIDATION_ERROR' || !Array.isArray(d.issues)) return null;
  for (const i of d.issues) {
    if (!i || typeof i !== 'object') continue;
    const { path, message } = i as { path?: unknown; message?: unknown };
    if (Array.isArray(path) && path[0] === 'serverDescription' && typeof message === 'string') return message;
  }
  return null;
}

/**
 * Что сказать про хост, который ни одна подписка не выдаст.
 *
 * `null` это «сказать нечего»: ключа нет (старый бэкенд) или хост не скрыт.
 * Имя ноды приходит снаружи: у хоста его нет, а строка без имени ноды не
 * объясняет, какая машина стоит в каскаде не входом.
 *
 * Два источника. Факт хоста главный, если хост его несёт: `null` у хоста это
 * тоже факт («не скрыт»), и нода его не перебивает. Факт ноды нужен там, где
 * хоста ещё нет: окно «Развернуть на нодах» до развёртывания, когда говорить
 * о скрытии как раз дешевле всего.
 */
export interface HostHiddenFacts {
  /** Null: the node list did not arrive. The fact is the host's and stands;
   *  only the name is unknown, and it is said so, never as «?» (A-234). */
  nodeName: string | null;
  cascadeId: string;
  cascadeName: string;
}

type HiddenBy = { cascadeId: string; cascadeName: string };

/** Whether any host of a profile sets its own security; `null` hosts (the
 *  list did not arrive) is «cannot tell», which keeps the caveat on. Moved
 *  here from formatReach.ts when the profile line went to /formats. */
export function hostsMaySecureOtherwise(hosts: readonly { securityLayer?: string | null }[] | null): boolean {
  if (hosts === null) return true;
  return hosts.some((h) => h.securityLayer === 'tls' || h.securityLayer === 'none');
}

/** The opening of the hidden line: the node by name, or said unknown. */
export function hiddenLineStart(facts: Pick<HostHiddenFacts, 'nodeName'>, t: (key: string, vars?: Record<string, unknown>) => string): string {
  return facts.nodeName === null ? t('hostHidden.beforeUnknown') : t('hostHidden.before', { node: facts.nodeName });
}

export function hostHiddenFacts(
  host: { hiddenByCascade?: HiddenBy | null } | null | undefined,
  nodeName: string | null,
  node?: { hiddenByCascade?: HiddenBy | null } | null,
): HostHiddenFacts | null {
  const h =
    host && host.hiddenByCascade !== undefined ? host.hiddenByCascade : node?.hiddenByCascade;
  if (!h) return null;
  return { nodeName, cascadeId: h.cascadeId, cascadeName: h.cascadeName };
}

/**
 * Two ways to say where a host lives, and the second is the one the create
 * screen uses.
 *
 * `bindingId` attaches to a binding that already exists. Nothing in this UI
 * creates bindings, so on a fresh install that path had no way to start.
 * `profileId` + `nodeId` + `port` says what the operator means, and the API
 * creates the binding in the same transaction as the host: a refused host
 * leaves no orphan behind, and no screen here lists bindings to clean up.
 */
export interface CreateHostInput {
  bindingId?: string;
  profileId?: string;
  nodeId?: string;
  /** Listen port for the binding. Required only when creating one. */
  port?: number;
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
  /** A-236 step 6: sent only when set or changed (visibilityPatch); null clears. */
  serverDescription?: string | null;
  isHidden?: boolean;
}

/**
 * A-259: what a new listen port moves. 'host' (the server's default) takes
 * this host to the inbound on that port, a new one when the profile does not
 * listen there yet; 'binding' moves the whole inbound with all its hosts.
 */
export type HostPortMove = 'host' | 'binding';

// The node is not edited here: moving a host to another node is a delete plus
// a create. Its listen port is (A-150, A-259): `port` with `portMove`, and the
// answer may carry another `bindingId`; `portOverride` is only what clients dial.
export type UpdateHostInput = Partial<Omit<CreateHostInput, 'bindingId' | 'profileId' | 'nodeId'>> & {
  /** Sent with `port` only. */
  portMove?: HostPortMove;
};

/**
 * The port fields of a host save (A-150). The «Port» field is the port the
 * node listens on (the binding's), «Client port» is the override clients dial
 * behind NAT or a CDN, empty when they dial the listen port.
 *
 * An edit sends each only when it changed: an absent key is no edit, and
 * restating the listen port would be read as a move. A create sends the listen
 * port always and the client port only when one was typed.
 *
 * A-259: an edit that moves the listen port says what moves (`portMove`),
 * and only then; a create sends none, the port itself picks the binding.
 */
export function hostPortPayload(
  stored: { listenPort: number; clientPort: number | null } | null,
  form: { port: number | ''; clientPort: number | '' },
  move?: HostPortMove,
): { port?: number; portOverride?: number | null; portMove?: HostPortMove } {
  const client = form.clientPort === '' ? null : form.clientPort;
  if (stored === null) {
    return {
      ...(form.port !== '' ? { port: form.port } : {}),
      ...(client !== null ? { portOverride: client } : {}),
    };
  }
  const moved = form.port !== '' && form.port !== stored.listenPort;
  return {
    ...(moved ? { port: form.port as number } : {}),
    ...(moved && move ? { portMove: move } : {}),
    ...(client !== stored.clientPort ? { portOverride: client } : {}),
  };
}

/**
 * 409 PROFILE_DOES_NOT_RUN_ON_NODE (A-161, A-235): the node reported its cores
 * and the profile's engine is not among them. Read before `portConflict`,
 * which takes any 409 for a port clash. The input is checked first; an
 * engine list with anything but strings, or a missing needed engine, is not
 * this refusal. `reportedEngines: []` means «reported, runs nothing».
 */
export interface ProfileNotOnNode {
  nodeName: string;
  neededEngine: string;
  reportedEngines: string[];
  canWait: boolean;
}

export function profileNotOnNode(err: unknown): ProfileNotOnNode | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 409 || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.error !== 'PROFILE_DOES_NOT_RUN_ON_NODE') return null;
  if (typeof d.nodeName !== 'string' || typeof d.neededEngine !== 'string') return null;
  if (!Array.isArray(d.reportedEngines) || !d.reportedEngines.every((e) => typeof e === 'string')) return null;
  return {
    nodeName: d.nodeName,
    neededEngine: d.neededEngine,
    reportedEngines: d.reportedEngines as string[],
    canWait: d.canWait === true,
  };
}

/**
 * The codes of a port clash: the three the save refuses with today (read
 * first by `portRefusalOf`, with their conflicts) and PORT_IN_USE of a server
 * older than the split. Only these are a port (A-235): any other 409 used to
 * land in the port field as «port taken».
 */
const PORT_CODES = new Set(['PORT_IN_USE', 'PORT_TAKEN_PROFILE', 'PORT_TAKEN_CASCADE', 'PORT_TAKEN_CORE_SERVICE']);

/** The port is taken on that node. The message names the profile holding it, so
 *  it is worth showing verbatim rather than replacing with "port busy". Null
 *  for anything that is not a port clash. */
export function portConflict(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: { error?: unknown; message?: unknown } } }).response;
  if (res?.status !== 409 || typeof res.data?.error !== 'string' || !PORT_CODES.has(res.data.error)) return null;
  return typeof res.data.message === 'string' ? res.data.message : '';
}

/** The profile or the node disappeared while the form was open. */
export function goneWhileEditing(err: unknown): boolean {
  return (err as { response?: { status?: number } }).response?.status === 404;
}

/**
 * Who is still holding the previous version of this host's link.
 *
 * Counts PEOPLE, not configs: one person with four devices is one row here,
 * because the question the screen asks is how many humans are about to find
 * out the hard way.
 */
export interface HostFreshness {
  /** When the link last changed shape, ISO. */
  configChangedAt: string;
  /** Subscribers who have fetched since that change. */
  current: number;
  /** Everyone else. Includes `neverFetched`. */
  stale: number;
  total: number;
  /**
   * The subset of `stale` with no fetch on record at all: either they never
   * took the link, or their last fetch has aged out of the window below.
   * Split out because "never installed it" and "has not opened it in three
   * months" read differently, even though the fix for both is the same.
   */
  neverFetched: number;
  /**
   * How far back the request history reaches. Beyond it the panel genuinely
   * cannot tell a quiet subscriber from an absent one, so the screen says the
   * number rather than pretending the answer is absolute. Never hardcode it:
   * it is a server setting and it moves.
   */
  retentionDays: number;
}

export async function getHostFreshness(id: string): Promise<HostFreshness> {
  const { data } = await api.get<HostFreshness>(`/api/hosts/${id}/freshness`);
  return data;
}

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
