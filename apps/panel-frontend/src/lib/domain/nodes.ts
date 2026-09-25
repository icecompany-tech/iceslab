import type { CoreComponent, EngineName, NodeCoreInfo, NodeCores, NodeCoreVersions } from '@iceslab/shared';
import type { AwgProtocol, AwgRuntime } from '@/lib/domain/awg';
import type { NodeGeoFact, NodeGeoIntended } from '@/lib/domain/geoSets';
import { api } from '@/lib/net/client';

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

/**
 * `Node.protocol` как его отдаёт сервер с 93ad747: метка, выведенная из ядер
 * (xray, если есть, иначе первое по ENGINE_NAMES). У ноды только с sing-box
 * это `singbox`, которого среди протоколов установки нет. Ничего по метке не
 * решается: ядра ноды это `intendedEngines`.
 */
export type NodeLabel = NodeProtocol | 'singbox';

// G (Zashchita / hardening) - probe-resistance toggles persisted to
// nodes.hardening. Each maps 1:1 to an install-iceslab-node.sh flag. NULL on a
// node = no hardening (install command is unchanged).
export interface NodeHardening {
  ufwLockdown?: boolean;
  fail2ban?: boolean;
  realisticFallback?: boolean;
  sshAllowlist?: string[];
}

/**
 * How often the node's xray core came back up, and how close it runs to the
 * ceiling that makes the agent restart it (2026-08-04).
 *
 * A restart drops every live connection, so this is the one number that turns
 * "users complain, panel is green" into something an operator can see.
 *
 * ⚠ The whole object is null on a node that never reported it - a pre-2026-08
 * agent, or one that has not checked in yet. That is NOT the same as zero
 * restarts, and the card must not print it as one. Same rule one level down:
 * `memoryLimitBytes` absent means the watchdog is off, not that it is zero.
 */
export interface CoreRestarts {
  /** crash + memory. */
  total: number;
  /** Core died on its own - growth here is a bug to chase, not maintenance. */
  crash: number;
  /** Watchdog acted before the kernel would have. */
  memory: number;
  /** Absent until something has actually restarted. */
  lastAt?: string;
  /** `crash` | `memory` - kept as a plain string, the panel treats anything
   *  that is not `memory` as a crash rather than rejecting it. */
  lastReason?: string;
  /** Armed ceiling in bytes; absent = watchdog off on that node. */
  memoryLimitBytes?: number;
  /** Latest resident-size sample of the core process. */
  rssBytes?: number;
  /**
   * When the panel last WROTE this tally, not when it last polled the node.
   * The status cron ticks every 30s but only persists when a counter moved or
   * RSS drifted >10%, so a steady core legitimately carries an old stamp. Show
   * it as a fact, never colour it as staleness - see NodeCard.
   */
  observedAt: string;
}

export interface Node {
  id: string;
  name: string;
  address: string;
  protocol: NodeLabel;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  /** See CoreRestarts. null = never reported, not zero. */
  coreRestarts: CoreRestarts | null;
  // T7 - proxy-core version (e.g. xray "26.3.27"), null until a versioned agent
  // reports in. Shown on the node card; cascade form warns on an old balancer entry.
  coreVersion: string | null;
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
  // Engine-choice: sing-box engine installed alongside the native core. Since
  // 64d7078 read off `intendedEngines` by the server ("singbox" in the list).
  singboxEngine: boolean;
  /**
   * Which engines the node is SET UP to carry (64d7078), a set: since 25.09 no
   * engine is the primary and the order means nothing. An intent: the installer and the node card read
   * it, no gate does; what the node RUNS is `engines` below. Absent = a server
   * older than the field, and the screens then keep protocol + sing-box switch.
   */
  intendedEngines?: EngineName[];
  /**
   * Which engines of this node the cascades it stands in need (core-lifecycle
   * §8): sing-box for a chain, xray for an entry. Disabled cascades come too,
   * with `enabled: false`: a core taken off would break them when switched
   * on. Empty = the node is in no cascade. Absent = a server older than the
   * field, which is not "no cascades": the screen then says it cannot tell.
   * Read through `readCascadeNeeds`, which checks the shape first.
   */
  cascadeNeedsEngines?: CascadeEngineNeed[];
  /**
   * Э3 layer B: the node-level routing policy this node runs, null = none.
   * Only the id: the rules live behind /api/node-policies and are shared, so a
   * node never carries a copy of them.
   */
  policyId: string | null;
  /**
   * Поколение AmneziaWG на этой ноде (фаза 7). См. `lib/domain/awg.ts`.
   *
   * ⚠ Три значения: `undefined` это «сервер поля не отдаёт» (экран молчит про
   * версию), `null` это «не задана» (читается как 1, так живут ноды до фазы
   * 7), `1 | 3` это выбор оператора. Контракт объявлен ARCH 23.09 заранее,
   * сервер отдаёт ключ всегда.
   */
  awgProtocol?: AwgProtocol | null;
  /** Как AWG исполняется на ноде (фаза 7): модуль ядра или отдельный процесс.
   *  `undefined` пока сервер поле не отдаёт; тогда экран об этом молчит. */
  awgRuntime?: AwgRuntime | null;
  /**
   * The cores this machine reported, with the panel's freshness stamp.
   *
   * ⚠ `null` means no reporting agent has ever checked in, which is NOT a node
   * with no cores. Nothing here may be derived from `protocol` or
   * `singboxEngine`: rendering a policy is a property of the ADAPTER, and which
   * adapters a node registers is decided in the agent's own main.go.
   */
  cores?: NodeCores | null;
  /**
   * The distinct engines those cores run: the answer to «can this node render
   * that profile», already deduped by the server.
   *
   * ⚠ ABSENT means the node has never reported, EMPTY means it reported and
   * runs nothing. The absence is the signal, with no boolean beside it that
   * could contradict the list. Never substitute `protocol` here: that field is
   * a label for which adapter is primary, and reading it as a capability list
   * refused 23 legitimate pairs when the backend tried it on 2026-09-11.
   */
  engines?: EngineName[];
  /**
   * Почему последний пуш конфига НЕ лёг, словами самого ядра.
   *
   * ⚠ `null` это «последний пуш прошёл» ИЛИ «ни одного не было», и различает их
   * `lastInboundSyncAt`, а не это поле. Состояние снимается само: удачный пуш
   * стирает его, поэтому «исправлено» рисовать нечем и не нужно.
   *
   * ⚠ Из `lastInboundSyncAt` отказ не выводится. Старый стамп это «ещё в пути»,
   * а не ошибка, и принять одно за другое значит показать красную строку там,
   * где ничего не сломалось.
   *
   * `message` приходит целиком, с префиксом агента и баннером ядра, до 2000
   * символов. Резать его можно только на показе: это чужой вывод, и урезанное
   * хранимое лишает оператора того самого куска, ради которого он смотрит.
   */
  lastInboundSyncError?: { at: string; message: string } | null;
  /**
   * Когда нода в последний раз ПРИНЯЛА конфиг. Ставится только при удачном
   * пуше, поэтому рядом с `lastInboundSyncError.at` читается как пара: что
   * позже, то и было последним.
   *
   * ⚠ Само по себе это не «когда пробовали»: отвергнутый пуш его не двигает.
   */
  lastInboundSyncAt?: string | null;
  /**
   * Что сказала нода про процесс цепи, и `null`, если не говорила ничего.
   *
   * ⚠ Читается только в паре с `chainSentAt`: см. `lib/domain/chainStatus.ts`.
   * `null` это обычное состояние ноды вне каскадов, а не поломка.
   */
  chainStatus?: { running: boolean; version?: string; error?: string } | null;
  /** Когда панель последний раз послала этой ноде блок цепи. */
  chainSentAt?: string | null;
  /**
   * Гео-файлы, которые лежат НА ЭТОЙ МАШИНЕ, с heartbeat (фаза 9,
   * geo-contract §4). Три значения: ключа нет = сервер его не отдаёт (смотреть
   * `fields`), `null` = нода не сообщила, объект = факт с диска. См.
   * `nodeGeoFacts`.
   */
  geo?: NodeGeoFact | null;
  /** Какие гео-файлы нода ДОЛЖНА нести по пинам и правилам; `null` = правила
   *  ни на один набор не ссылаются. */
  geoIntended?: NodeGeoIntended | null;
  /**
   * Нода стоит в каскаде не входом: хост на ней подписка не выдаёт, пока каскад
   * включён. Те же три значения, что у хоста: ключа нет (бэкенд старше поля или
   * ответ не из GET /api/nodes и /api/nodes/:id), `null` не скрыта, объект
   * скрыта этим каскадом. См. `hostHiddenFacts`.
   */
  hiddenByCascade?: { cascadeId: string; cascadeName: string } | null;
  /**
   * Какие версии ядер оператор хочет на этой ноде. Отсутствие компонента это
   * пин манифеста. Ключа нет вовсе: сервер старше поля, выбор версии молчит и
   * в запрос не уходит.
   */
  coreVersions?: NodeCoreVersions;
  createdAt: string;
  updatedAt: string;
}

/**
 * One core as the panel keeps it, re-exported so screens do not each reach into
 * the transport package for it.
 *
 * ⚠ `rendersPolicy` and `rendersDns` are OPTIONAL, and the absence is a third
 * answer: an agent older than the field reports neither, and that is unknown,
 * not false. Saying «the policy is ignored here» about a core that applies it
 * is worse than silence.
 */
export type NodeCore = NodeCoreInfo;

/** One engine of a node that cascades need, with those cascades (core-lifecycle §8). */
export interface CascadeEngineNeed {
  engine: EngineName;
  cascades: { id: string; name: string; enabled: boolean }[];
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
  /**
   * Имена необязательных ключей DTO ноды, которые этот сервер отдаёт (E29).
   * Отвечает на «знает ли сервер поле» и на пустом парке. Нет ключа: сервер
   * старше, и знание выводится по нодам (`nodeFieldKnown`).
   */
  fields?: string[];
}

export interface CreateNodeInput {
  name: string;
  address: string;
  /** Метка установки, в паре со списком ядер (engineListForLabel). */
  protocol: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
  regionId?: string | null;
  maxUsers?: number | null;
  domain?: string | null;
  hardening?: NodeHardening | null;
  singboxEngine?: boolean;
  /** The engines to install, a set; only to a server that knows the field.
   *  While the server still checks `protocol` against the first engine, the
   *  list goes ordered for it (engineListForLabel). 400 INVALID_ENGINES. */
  intendedEngines?: EngineName[];
  /** Поколение AmneziaWG (фаза 7). Уходит ТОЛЬКО если оператор его выбирал:
   *  до контракта сервер поля не знает, и ключ, которого он не ждёт, это отказ
   *  сохранения. */
  awgProtocol?: AwgProtocol | null;
  /** Версии ядер на установку, только выбранные; нет ключа = все пины.
   *  Отказ 400 CORE_VERSION_NOT_LISTED, см. `coreVersionRefusal`. */
  coreVersions?: NodeCoreVersions;
}

export interface UpdateNodeInput {
  /** См. `CreateNodeInput.awgProtocol`: только при правке. */
  awgProtocol?: AwgProtocol | null;
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
  /** Absent = untouched, a list replaces the list; never null (400). */
  intendedEngines?: EngineName[];
  /**
   * Which node policy this node runs. `null` detaches it, which rewrites the
   * node's config WITHOUT the rules rather than leaving the last policy
   * running, so sending null is a real action and not a no-op.
   *
   * A save the node cannot carry out comes back 409 POLICY_DOES_NOT_FIT_NODE
   * naming the node and the reason (a WARP rule with no WARP here, a cascade
   * direction this node does not dial). The screen shows that sentence.
   */
  policyId?: string | null;
  /**
   * Три значения на компонент: версия пишется, null возвращает на пин,
   * пропущенный компонент не трогается; null на всё = все пины. Отказ 400
   * CORE_VERSION_NOT_LISTED с `problems`, см. `coreVersionRefusal`.
   */
  coreVersions?: Partial<Record<CoreComponent, string | null>> | null;
}

/**
 * Did the last save actually reach this machine?
 *
 * A node's config is assembled from the bindings, profiles, hosts and cascades
 * behind it, so "saved" and "running" are two different moments and the gap
 * between them is an async push. Four aggregates per node, which is why the
 * answer is per-node and deliberately NOT on the list DTO.
 */
export interface NodeSyncStatus {
  /** Last acknowledged push, ISO. null = this node has never taken a config. */
  lastInboundSyncAt: string | null;
  /** When the config this node should be running was last edited, ISO. */
  configChangedAt: string;
  applied: boolean;
  /**
   * Travels with `applied` on purpose. An unapplied config on an OFFLINE node
   * is waiting, not stuck: the cron re-pushes when it comes back. The two
   * deserve different words, and without this flag the card cannot tell them
   * apart.
   */
  online: boolean;
}

export async function getNodeSyncStatus(id: string): Promise<NodeSyncStatus> {
  const { data } = await api.get<NodeSyncStatus>(`/api/nodes/${id}/sync-status`);
  return data;
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

/** Largest page the list endpoint accepts; asking for more is a 400. */
const NODES_PAGE_MAX = 100;

/**
 * One node by id. There is no single-node GET, so this walks the list a page
 * at a time and stops at the first match. Cheap for any fleet that fits one
 * page, and correct for the ones that do not.
 */
export async function findNode(id: string): Promise<Node | null> {
  for (let page = 1; ; page++) {
    const res = await listNodes({ page, limit: NODES_PAGE_MAX });
    const hit = res.nodes.find((n) => n.id === id);
    if (hit) return hit;
    if (page * NODES_PAGE_MAX >= res.total || res.nodes.length === 0) return null;
  }
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
