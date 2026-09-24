import { CORE_COMPONENTS, type CoreComponent, type EngineName, type NodeCoreVersions } from '@iceslab/shared';
import type { NodeProtocol } from '@/lib/domain/nodes';
import { PROTOCOL_OPTIONS, SINGBOX_ENGINE_CAPABLE } from '@/contours/nodes/lib/nodeProtocols';
import type { AwgProtocol } from '@/lib/domain/awg';
import { nativeEngineOfIntent } from '@/lib/domain/engines';
import { componentsOfEngine } from '@iceslab/shared';
import { coreReleaseOptions } from '@/lib/domain/coreVersions';

export interface FormValues {
  /** Выбор версий ядер на установку: нет компонента = пин манифеста. */
  coreVersions: NodeCoreVersions;
  /** Поколение AmneziaWG (фаза 7). `null` = не задано, сервер читает как 1. */
  awgProtocol: AwgProtocol | null;
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
  domain: string;
  singboxEngine: boolean;
  /** The engines the node is set up to carry, first = primary (intendedEngines).
   *  `protocol` is the primary's install label, chosen under its chip. */
  engines: EngineName[];
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}

// Listen ports handed to new hosts, in preference order. Mirrors the backend's
// CANDIDATE_PORTS so the ports promised here are the ports actually bound.
export const CANDIDATE_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

/** Next candidate port not already handed to another host on this node. */
export function pickFreePort(used: number[]): number {
  const taken = new Set(used);
  for (const p of CANDIDATE_PORTS) if (!taken.has(p)) return p;
  for (let p = 20000; p <= 65000; p++) if (!taken.has(p)) return p;
  return 443;
}

/**
 * Which core components the create wizard offers a version for, and in what
 * order: the ones the chosen engines will install first, the rest folded
 * under «остальные ядра» (a node can gain them later, and the choice rides the
 * same bootstrap). A component with no release to choose (caddy-naive is built
 * from a branch) is not offered at all.
 */
export function wizardCoreComponents(engines: readonly string[]): { relevant: CoreComponent[]; others: CoreComponent[] } {
  const pickable = (c: CoreComponent) => coreReleaseOptions(c).length > 0;
  const relevant = [...new Set(engines)].flatMap((e) => componentsOfEngine(e)).filter(pickable);
  const others = CORE_COMPONENTS.filter((c) => !relevant.includes(c) && pickable(c));
  return { relevant, others };
}

/**
 * The engines of the old form (one protocol and the sing-box switch), for a
 * server older than `intendedEngines` and for the wizard's first render.
 */
export function legacyEngines(protocol: string, singboxEngine: boolean): EngineName[] {
  const primary = nativeEngineOfIntent(protocol);
  return primary !== 'singbox' && singboxEngine ? [primary, 'singbox'] : [primary];
}

/* ───── Node engines (intendedEngines, 64d7078) ─────────────────────────── */

/**
 * The protocols a primary engine can be installed as: the choice under the
 * primary chip. xray is xray or shadowsocks, sing-box is tuic, anytls or
 * shadowtls, every other engine is its own protocol. Read off the protocol
 * list through nativeEngineOfIntent, the same mapping the server checks with.
 */
export function primaryProtocols(engine: EngineName): NodeProtocol[] {
  return PROTOCOL_OPTIONS.map((p) => p.value).filter((p) => nativeEngineOfIntent(p) === engine);
}

/** Add an engine at the end, or take it off; the last one cannot go. */
export function toggleEngine(engines: readonly EngineName[], engine: EngineName): EngineName[] {
  if (!engines.includes(engine)) return [...engines, engine];
  return engines.length > 1 ? engines.filter((e) => e !== engine) : [...engines];
}

/** Move an engine to the front: the first one is the primary. */
export function makePrimary(engines: readonly EngineName[], engine: EngineName): EngineName[] {
  if (!engines.includes(engine)) return [...engines];
  return [engine, ...engines.filter((e) => e !== engine)];
}

/**
 * The protocol once the primary is known: kept when the primary still serves
 * it (shadowsocks stays under xray), else the primary's first protocol. The
 * server refuses a protocol its first engine does not serve.
 */
export function protocolForPrimary(current: NodeProtocol, primary: EngineName): NodeProtocol {
  const options = primaryProtocols(primary);
  return options.includes(current) ? current : (options[0] ?? current);
}

/**
 * The engine fields of a create or update body, by what the server knows:
 * `intendedEngines` and `protocol` when it has the field, the old `protocol`
 * and `singboxEngine` when it does not (it would refuse the new key).
 */
export function enginesPayload(
  known: boolean,
  engines: readonly EngineName[],
  protocol: NodeProtocol,
): { intendedEngines: EngineName[]; protocol: NodeProtocol } | { protocol: NodeProtocol; singboxEngine: boolean } {
  if (known) return { intendedEngines: [...engines], protocol };
  return { protocol, singboxEngine: engines.includes('singbox') && SINGBOX_ENGINE_CAPABLE.includes(protocol) };
}

/**
 * The 400 INVALID_ENGINES: the field it names and the server's sentence, or
 * null for any other error. The input is checked first.
 */
export function nodeEnginesRefusal(
  err: unknown,
): { field: 'intendedEngines' | 'protocol' | 'singboxEngine'; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; message?: unknown; path?: unknown };
  if (d.error !== 'INVALID_ENGINES') return null;
  const field = Array.isArray(d.path) ? d.path[0] : undefined;
  if (field !== 'intendedEngines' && field !== 'protocol' && field !== 'singboxEngine') return null;
  return { field, message: typeof d.message === 'string' ? d.message : '' };
}

/**
 * The `coreVersions` of the create request: only what the operator picked,
 * and nothing at all when nothing was (the server then installs the pins).
 * `known` is whether the server has the field; an older one would refuse an
 * unexpected key.
 */
export function createCoreVersions(known: boolean, picked: NodeCoreVersions): NodeCoreVersions | undefined {
  if (!known) return undefined;
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/** What the third step needs to remember about the node it just registered. */
export interface Registered {
  id: string;
  name: string;
  address: string;
  token: string;
  expiresAt: string;
  command: string;
  payload: string;
  /** Profile name and port per host that was attached, for the timeline. */
  hosts: { name: string; port: number }[];
}

