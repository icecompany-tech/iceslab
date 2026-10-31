import type { EngineName, NodeCoreVersions } from '@iceslab/shared';
import type { Node, NodeLabel, NodeProtocol } from '@/lib/domain/nodes';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
import { multiplierInput } from '@/contours/nodes/lib/nodeLimits';
export interface FormValues {
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  regionId: string;
  /** A-057: the node's own FQDN (self-steal serverName). '' means none; sent
   *  only when changed (domainPatch). */
  domain: string;
  /** Typed text, comma or dot (A-143, parseMultiplier); never a rounded number. */
  consumptionMultiplier: string;
  maxUsers: number | '';
  /** Э3 layer B: which node policy runs here. '' means none, and saving '' is
   *  a real detach, not a no-op: the config is rewritten without the rules. */
  policyId: string;
  /** Намерение по версиям ядер, как в `Node.coreVersions`: нет компонента =
   *  пин. На сервер уходит только разница с сохранённым (`coreVersionsPatch`). */
  coreVersions: NodeCoreVersions;
  /** Ядра ноды (intendedEngines), только для показа: на странице ноды их не
   *  правят (E42, 2359c7e), состав сообщает нода по командам «Ядер». Пусто,
   *  если сервер поля не знает: тогда на экране прежний селект протокола. */
  engines: EngineName[];
}

/**
 * Поля ядер и метки в PUT ноды (E42, 2359c7e):
 *
 *   сервер без `intendedEngines`   `protocol` из прежнего селекта, как было;
 *   сервер с полем                 ничего: ядра на странице ноды только
 *                                  показываются, их ставят и снимают командами
 *                                  «Ядер», и нода сообщает состав сама. Ни
 *                                  `intendedEngines`, ни `singboxEngine`, ни
 *                                  метка в PUT не уходят.
 */
export function nodeEnginesPut(known: boolean, protocol: NodeProtocol): { protocol?: NodeProtocol } {
  return known ? {} : { protocol };
}

/**
 * Метка ноды как значение формы. Сервер 93ad747 выводит `singbox` у ноды
 * только с sing-box; протокола установки с таким именем нет, и в форме он
 * читается как tuic, первый протокол sing-box. `none` (нода без ядер) как
 * xray, прежнее значение по умолчанию. Уходит эта метка только в
 * паре со списком ядер (engineListForLabel), а новый сервер метку на записи
 * не слушает; старый `singbox` не отдаёт вовсе.
 */
export function formProtocolOf(label: NodeLabel | undefined): NodeProtocol {
  if (label === undefined || label === 'none') return 'xray';
  return label === 'singbox' ? 'tuic' : label;
}

/**
 * The domain in the node's PUT (A-057). The server takes it and, when it
 * changes, pushes the node again: self-steal serverNames and every link's SNI
 * follow it (nodes.service.ts, domainChanged). So it goes only when it differs
 * from the stored one; a cleared field is null, which takes the domain off.
 */
export function domainPatch(stored: string | null | undefined, typed: string): { domain?: string | null } {
  const next = typed.trim() || null;
  return next === (stored ?? null) ? {} : { domain: next };
}

/** The server's shape for a domain: a bare FQDN, no scheme, no port, at most
 *  255 (nodes.schemas.ts DomainSchema). Empty is no domain and passes. */
export function domainOk(typed: string): boolean {
  const v = typed.trim();
  return v === '' || (v.length <= 255 && /^[a-zA-Z0-9.-]+$/.test(v));
}

export function splitAddress(address: string): { host: string; port: number } {
  const idx = address.lastIndexOf(':');
  if (idx === -1) return { host: address, port: DEFAULT_NODE_PORT };
  const port = Number.parseInt(address.slice(idx + 1), 10);
  return {
    host: address.slice(0, idx),
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_NODE_PORT,
  };
}

export function defaults(node: Node | null, decimalComma = false): FormValues {
  const { host, port } = splitAddress(node?.address ?? '');
  return {
    name: node?.name ?? '',
    host,
    port,
    protocol: formProtocolOf(node?.protocol),
    countryCode: node?.countryCode ?? '',
    regionId: node?.regionId ?? '',
    domain: node?.domain ?? '',
    consumptionMultiplier: multiplierInput(node ? node.consumptionMultiplier : 1, decimalComma),
    maxUsers: node?.maxUsers ?? '',
    policyId: node?.policyId ?? '',
    coreVersions: { ...(node?.coreVersions ?? {}) },
    engines: [...(node?.intendedEngines ?? [])],
  };
}

/**
 * Which way traffic leaves the node, as the page may say it. `unknown` while
 * the cascade list has not arrived: a node is in a cascade or not only by that
 * list, and reading a missing list as «no cascade» showed a cascade hop as
 * going straight out (spec frontend-nodes). WARP is a fact on the node, but a
 * cascade overrides it, so it cannot be said either until the list is in.
 */
export type Egress = 'direct' | 'warp' | 'cascade' | 'unknown';

export function egressOf(inCascade: boolean, cascadesKnown: boolean, warpOn: boolean): Egress {
  if (inCascade) return 'cascade';
  if (!cascadesKnown) return 'unknown';
  return warpOn ? 'warp' : 'direct';
}
