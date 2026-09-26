import type { EngineName, NodeCoreVersions } from '@iceslab/shared';
import type { Node, NodeLabel, NodeProtocol } from '@/lib/domain/nodes';
import type { AwgProtocol } from '@/lib/domain/awg';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
export interface FormValues {
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  regionId: string;
  consumptionMultiplier: number | '';
  maxUsers: number | '';
  /** Э3 layer B: which node policy runs here. '' means none, and saving '' is
   *  a real detach, not a no-op: the config is rewritten without the rules. */
  policyId: string;
  /** Поколение AmneziaWG (фаза 7). `null` = не задано, читается как 1. Уходит
   *  на сервер только правленым (см. `awgPayload`). */
  awgProtocol: AwgProtocol | null;
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

export function splitAddress(address: string): { host: string; port: number } {
  const idx = address.lastIndexOf(':');
  if (idx === -1) return { host: address, port: DEFAULT_NODE_PORT };
  const port = Number.parseInt(address.slice(idx + 1), 10);
  return {
    host: address.slice(0, idx),
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_NODE_PORT,
  };
}

export function defaults(node: Node | null): FormValues {
  const { host, port } = splitAddress(node?.address ?? '');
  return {
    name: node?.name ?? '',
    host,
    port,
    protocol: formProtocolOf(node?.protocol),
    countryCode: node?.countryCode ?? '',
    regionId: node?.regionId ?? '',
    consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
    maxUsers: node?.maxUsers ?? '',
    policyId: node?.policyId ?? '',
    awgProtocol: node?.awgProtocol ?? null,
    coreVersions: { ...(node?.coreVersions ?? {}) },
    engines: [...(node?.intendedEngines ?? [])],
  };
}
