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
  /**
   * Тот же номер порта, занятый ДРУГИМ транспортом.
   *
   * Не конфликт: 443/tcp и 443/udp это разные сокеты, и рядом они стоят
   * штатно. Сказано отдельным полем как раз затем, чтобы соседство было видно
   * и не пугало: человек, набравший занятый на вид номер, должен понимать, что
   * панель это заметила и не возражает.
   */
  otherTransport: { holder: PortOwner } | null;
  /** Ключ пояснения либо `null`, когда пояснять нечего. */
  note: 'reserved-ports-unknown' | null;
}

/** Коды, которыми сохранение отказывает по занятому порту. */
export type PortTakenCode =
  | 'PORT_TAKEN_PROFILE'
  | 'PORT_TAKEN_CASCADE'
  | 'PORT_TAKEN_CORE_SERVICE';

/**
 * Отказ сохранения по порту, если это он.
 *
 * Код лежит в поле `error`, как у всех соседних отказов, а `conflicts` приходит
 * ТЕМ ЖЕ союзом, что у проверки порта. Поэтому экран рисует отказ тем же кодом
 * и теми же словами, что и подсказку: две формулировки одного события разошлись
 * бы на первой же правке.
 */
export function portRefusalOf(err: unknown): { code: PortTakenCode; conflicts: PortOwner[] } | null {
  const body = (err as { response?: { data?: unknown } } | null)?.response?.data as
    | { error?: string; conflicts?: PortOwner[] }
    | undefined;
  const code = body?.error;
  if (code !== 'PORT_TAKEN_PROFILE' && code !== 'PORT_TAKEN_CASCADE' && code !== 'PORT_TAKEN_CORE_SERVICE') {
    return null;
  }
  // Пустой список тоже ответ: код уже говорит, ЧТО случилось, а строку без
  // подробностей экран покажет по коду.
  return { code, conflicts: body?.conflicts ?? [] };
}

export async function checkNodePort(
  nodeId: string,
  input: { port: number; transport: Transport; exceptBindingId?: string },
): Promise<PortCheckResult> {
  const { data } = await api.post<PortCheckResult>(`/api/nodes/${nodeId}/port-check`, input);
  return data;
}
