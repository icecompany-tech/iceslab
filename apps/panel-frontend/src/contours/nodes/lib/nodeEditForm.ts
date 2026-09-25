import type { EngineName, NodeCoreVersions } from '@iceslab/shared';
import type { Node, NodeLabel, NodeProtocol } from '@/lib/domain/nodes';
import type { AwgProtocol } from '@/lib/domain/awg';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
import { engineListForLabel, sameEngines } from '@/contours/nodes/lib/nodeCreateForm';
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
  /** Ядра ноды (intendedEngines), множество без основного. Пусто, если сервер
   *  поля не знает: тогда на экране прежний селект протокола. На сервер уходит
   *  только изменённым (`nodeEnginesPut`). */
  engines: EngineName[];
}

/**
 * The `intendedEngines` of a PUT, by the three-value rule: absent = untouched,
 * a list replaces the list, and null is never sent (the server refuses it). Only
 * a changed list goes, and only to a server that has the field (`stored`
 * present). The list is a set (25.09): the same cores in another order are no
 * edit.
 */
export function enginesPatch(stored: EngineName[] | undefined, edited: EngineName[]): EngineName[] | undefined {
  if (stored === undefined || edited.length === 0) return undefined;
  return sameEngines(stored, edited) ? undefined : [...edited];
}

/**
 * Поля ядер и метки в PUT ноды:
 *
 *   сервер без `intendedEngines`   `protocol` из прежнего селекта, как было;
 *   ядра не правились              ничего: отсутствие ключа = нет правки;
 *   правились                      список и метка в паре (engineListForLabel):
 *                                  сервер, что метку сверяет, иначе ответил бы
 *                                  400 INVALID_ENGINES, новый её игнорирует.
 */
export function nodeEnginesPut(
  known: boolean,
  stored: EngineName[] | undefined,
  edited: EngineName[],
  protocol: NodeProtocol,
): { protocol?: NodeProtocol; intendedEngines?: EngineName[] } {
  if (!known) return { protocol };
  const diff = enginesPatch(stored, edited);
  if (!diff) return {};
  const pair = engineListForLabel(diff, protocol);
  return { intendedEngines: pair.engines, protocol: pair.protocol };
}

/**
 * Метка ноды как значение формы. Сервер 93ad747 выводит `singbox` у ноды
 * только с sing-box; протокола установки с таким именем нет, и в форме он
 * читается как tuic, первый протокол sing-box. Уходит эта метка только в
 * паре со списком ядер (engineListForLabel), а новый сервер метку на записи
 * не слушает; старый `singbox` не отдаёт вовсе.
 */
export function formProtocolOf(label: NodeLabel | undefined): NodeProtocol {
  if (label === undefined) return 'xray';
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
