import type { AwgProtocol } from '@iceslab/shared';

export { AWG_PROTOCOLS, type AwgProtocol } from '@iceslab/shared';

/**
 * Поколение протокола AmneziaWG (фаза 7, контракт BACK 227054e, 26.09).
 *
 * Два разных поля, и путать их нельзя:
 *   node.awgProtocol     ФАКТ: какое поколение говорит модуль ядра на машине,
 *                        из отчёта ноды. Не выбирается: модуль ставит
 *                        bootstrap. Модуль 3.1 несёт профили 1.x и 3.1, модуль
 *                        1.x только 1.x;
 *   profile.awgProtocol  ВЫБОР оператора у профиля AmneziaWG: какое поколение
 *                        профиль раздаёт. null = 1.
 *
 * Сервер отказывает профилю 3.1 на ноде с модулем 1.x
 * (409 AWG_PROTOCOL_MISMATCH), и только по сообщённому факту: у ноды null
 * отказа нет.
 */

/** Как поколение называется словами. «3.1», а не «3»: клиенты и роутеры
 *  различают именно эту версию протокола, и оператор ищет её по этому имени. */
export function awgLabel(g: AwgProtocol): string {
  return g === 3 ? '3.1' : '1.x';
}

/**
 * Строка факта у ядра amneziawg в «Ядрах».
 *
 *   undefined  сервер поля не отдаёт: строки нет;
 *   null       нода поколение не сообщила: «поколение не сообщено». Как 1 НЕ
 *              читается: агент старше поля или модуль без говорящей версии, и
 *              сервер по такому не отказывает;
 *   1 | 3      что говорит модуль.
 */
export type NodeAwgFact = 'awg3' | 'awg1' | 'unreported';

export function nodeAwgFact(value: AwgProtocol | null | undefined): NodeAwgFact | null {
  if (value === undefined) return null;
  if (value === null) return 'unreported';
  return value === 3 ? 'awg3' : 'awg1';
}

/**
 * Какие интерфейсы несёт АГЕНТ ноды (`cores[].awgGenerations`, 24b59b9), вторая
 * часть строки amneziawg в «Ядрах». Не то же, что модуль: модуль 3.1 при старом
 * агенте профиль 3.1 не поднимет.
 *
 *   known false        сервер поля не отдаёт (нет `cores[].awgGenerations` в
 *                      `fields`): строки нет;
 *   [1, 3]             «агент несёт интерфейсы 1.x и 3.1»;
 *   [1] или нет ключа  «агент несёт только 1.x, пересоберите». Здесь, одном
 *                      месте контракта, отсутствие это ответ: агент старше
 *                      поля 3.1 не поднимет, и сервер отказывает так же
 *                      (AWG_AGENT_TOO_OLD).
 */
export type AgentAwgFact = 'both' | 'only1';

export function agentAwgFact(known: boolean, generations: unknown): AgentAwgFact | null {
  if (!known) return null;
  return Array.isArray(generations) && generations.includes(3) ? 'both' : 'only1';
}

/**
 * Значок поколения у имени профиля AmneziaWG (карточка профиля, хост): только
 * у 3.1. 1.x это умолчание всего парка, и значок на каждом профиле был бы
 * шумом, из-за которого перестают замечать 3.1.
 */
export function awgGenerationBadge(profile: { protocol: string; awgProtocol?: AwgProtocol | null } | null | undefined): string | null {
  return profile?.protocol === 'amneziawg' && profile.awgProtocol === 3 ? awgLabel(3) : null;
}

/** Поколение профиля с null, прочитанным как 1, как читает сервер. */
export function profileAwgGeneration(value: AwgProtocol | null | undefined): AwgProtocol {
  return value === 3 ? 3 : 1;
}

/**
 * Ключ `awgProtocol` в PUT профиля, или пустой объект.
 *
 * Уходит только при смене поколения и только когда сервер поле знает
 * (`stored` не undefined): отсутствие ключа это «не трогали». Возврат на 1.x
 * уходит как null, так сервер хранит поколение по умолчанию.
 */
export function profileAwgPatch(
  stored: AwgProtocol | null | undefined,
  chosen: AwgProtocol,
): { awgProtocol?: AwgProtocol | null } {
  if (stored === undefined) return {};
  if (profileAwgGeneration(stored) === chosen) return {};
  return { awgProtocol: chosen === 3 ? 3 : null };
}

/** Ключ в POST нового профиля: только 3, 1.x это умолчание сервера. */
export function profileAwgCreate(chosen: AwgProtocol): { awgProtocol?: AwgProtocol } {
  return chosen === 3 ? { awgProtocol: 3 } : {};
}
