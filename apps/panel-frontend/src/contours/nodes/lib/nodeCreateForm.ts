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
  /** Ядра, на которые нода настроена (intendedEngines): множество, порядок
   *  ничего не значит. `protocol` при известном поле экраном не выбирается,
   *  это метка для сервера, который её ещё сверяет (engineListForLabel). */
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
 * same bootstrap). Every component of the manifest gets its row: one with no
 * release to choose (caddy-naive is built on the node from a branch) says so
 * in place of a picker (`corePickable`), rather than vanishing from the list
 * as if NaiveProxy installed nothing.
 */
export function wizardCoreComponents(engines: readonly string[]): { relevant: CoreComponent[]; others: CoreComponent[] } {
  const relevant = [...new Set([...new Set(engines)].flatMap((e) => componentsOfEngine(e)))];
  const others = CORE_COMPONENTS.filter((c) => !relevant.includes(c));
  return { relevant, others };
}

/** Есть ли у компонента релиз на выбор; нет у собираемого из ветки. */
export function corePickable(c: CoreComponent): boolean {
  return coreReleaseOptions(c).length > 0;
}

/**
 * The engines of the old form (one protocol and the sing-box switch), for a
 * server older than `intendedEngines` and for the wizard's first render.
 */
export function legacyEngines(protocol: string, singboxEngine: boolean): EngineName[] {
  const own = nativeEngineOfIntent(protocol);
  return own !== 'singbox' && singboxEngine ? [own, 'singbox'] : [own];
}

/* ───── Node engines (intendedEngines, 64d7078) ─────────────────────────── */

/*
 * Ядра ноды это МНОЖЕСТВО (решение владельца 25.09: «не должно быть понятия
 * основного ядра»). Порядок не хранится и ничего не значит, выбирать «главное»
 * оператору нечего: `Node.protocol` у сервера выведенная метка, а какой
 * протокол обслуживает sing-box или xray, решает хост при привязке.
 */

/** Протоколы, которые движок обслуживает, по той же таблице, что у сервера. */
function protocolsOfEngine(engine: EngineName): NodeProtocol[] {
  return PROTOCOL_OPTIONS.map((p) => p.value).filter((p) => nativeEngineOfIntent(p) === engine);
}

/** Отметить ядро или снять его; последнее снять нельзя. */
export function toggleEngine(engines: readonly EngineName[], engine: EngineName): EngineName[] {
  if (!engines.includes(engine)) return [...engines, engine];
  return engines.length > 1 ? engines.filter((e) => e !== engine) : [...engines];
}

/** Одно ли это множество ядер: порядок не в счёт. */
export function sameEngines(a: readonly EngineName[], b: readonly EngineName[]): boolean {
  return a.length === b.length && a.every((e) => b.includes(e));
}

/**
 * Список и метка для сервера, который ещё читает первое ядро как основное (до
 * работы BACK 25.09): он требует, чтобы `protocol` обслуживало ПЕРВОЕ ядро, а
 * у sing-box первым метку назвать обязательно. Нынешняя метка сохраняется,
 * если её обслуживает хоть одно отмеченное ядро: оно встаёт первым
 * (shadowsocks при снятом hysteria остаётся shadowsocks). Иначе метка первого
 * ядра по таблице. Порядок остальных как был.
 */
export function engineListForLabel(
  engines: readonly EngineName[],
  current: NodeProtocol,
): { engines: EngineName[]; protocol: NodeProtocol } {
  const serving = engines.find((e) => nativeEngineOfIntent(current) === e);
  if (serving) return { engines: [serving, ...engines.filter((e) => e !== serving)], protocol: current };
  const first = engines[0];
  return { engines: [...engines], protocol: (first && protocolsOfEngine(first)[0]) || current };
}

/**
 * Поля ядер в теле создания, по тому, что сервер знает:
 *
 *   сервер без `intendedEngines`   прежние `protocol` и `singboxEngine` (новый
 *                                  ключ он отверг бы);
 *   сервер с полем, метку ещё      список и метка в паре (engineListForLabel);
 *   сверяет
 *   сервер выводит метку сам       только список: `protocol` он игнорирует, и
 *   (`protocolDerived`)            слать выбор, которого на экране нет, незачем.
 */
export function enginesPayload(
  known: boolean,
  protocolDerived: boolean,
  engines: readonly EngineName[],
  protocol: NodeProtocol,
):
  | { intendedEngines: EngineName[] }
  | { intendedEngines: EngineName[]; protocol: NodeProtocol }
  | { protocol: NodeProtocol; singboxEngine: boolean } {
  if (known && protocolDerived) return { intendedEngines: [...engines] };
  if (known) {
    const pair = engineListForLabel(engines, protocol);
    return { intendedEngines: pair.engines, protocol: pair.protocol };
  }
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

