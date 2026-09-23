import { CORE_COMPONENTS, type CoreComponent, type NodeCoreVersions } from '@iceslab/shared';
import type { NodeProtocol } from '@/lib/domain/nodes';
import type { AwgProtocol } from '@/lib/domain/awg';
import { nativeEngineOfIntent } from '@/lib/domain/engines';
import { componentsOfEngine, coreReleaseOptions } from '@/lib/domain/coreVersions';

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
 * order: the ones the chosen protocol and engine will install first, the rest
 * folded under «остальные ядра» (a node can gain them later, and the choice
 * rides the same bootstrap). A component with no release to choose (caddy-naive
 * is built from a branch) is not offered at all.
 */
export function wizardCoreComponents(
  protocol: string,
  singboxEngine: boolean,
): { relevant: CoreComponent[]; others: CoreComponent[] } {
  const pickable = (c: CoreComponent) => coreReleaseOptions(c).length > 0;
  const engines = new Set<string>([nativeEngineOfIntent(protocol), ...(singboxEngine ? ['singbox'] : [])]);
  const relevant = [...engines].flatMap((e) => componentsOfEngine(e)).filter(pickable);
  const others = CORE_COMPONENTS.filter((c) => !relevant.includes(c) && pickable(c));
  return { relevant, others };
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

