import type { Transport } from '@iceslab/shared';
import { api } from '@/lib/net/client';

/**
 * Свободен ли порт на этой ноде, и НАСКОЛЬКО панель в этом уверена.
 *
 * Подсказка, а не ворота. Последняя стена стоит на сохранении, в бэкенде: он
 * знает состояние на момент записи, а эта проверка знает его на момент blur, и
 * между ними помещается чужой коммит. Экран, который запрещает Save по своему
 * ответу, начинает врать ровно тогда, когда разошёлся с сервером.
 */

/** Кто держит порт. `core-service` отдаёт КЛЮЧ, а не готовую фразу: страница
 *  двуязычная и пишет предложение сама. */
export type PortOwner =
  | { kind: 'profile'; port: number; transport: Transport; name: string }
  | { kind: 'cascade'; port: number; transport: Transport; name: string }
  | { kind: 'core-service'; port: number; transport: Transport; ownerKey: string };

/**
 * Полон ли ответ.
 *
 * `full`: сказали все три источника, привязки, каскады и сама нода.
 * `partial`: нода не отчитывалась или её агент старше поля `reservedPorts`, то
 * есть служебные порты ядер неизвестны.
 *
 * ⚠ `partial` с пустым списком это `ok: true`, и это не мягкость. Отказать по
 * незнанию значило бы запретить порт, который на этой ноде свободен с тех пор,
 * как агент ещё не умел о нём рассказывать.
 */
export type PortCertainty = 'full' | 'partial';

export interface PortCheckResult {
  ok: boolean;
  certainty: PortCertainty;
  conflicts: PortOwner[];
  /** Ключ пояснения либо `null`, когда пояснять нечего. */
  note: 'reserved-ports-unknown' | null;
}

export async function checkNodePort(
  nodeId: string,
  input: { port: number; transport: Transport; exceptBindingId?: string },
): Promise<PortCheckResult> {
  const { data } = await api.post<PortCheckResult>(`/api/nodes/${nodeId}/port-check`, input);
  return data;
}
