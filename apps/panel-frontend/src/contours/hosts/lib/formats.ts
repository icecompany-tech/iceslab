import { FORMAT_NAMES, type SubscriptionFormat } from '@iceslab/shared';

/**
 * Форматы подписки, которые можно выключить у хоста.
 *
 * ⚠ Список ОДИН и живёт в контракте. Своя копия на экране хоста стоила
 * issue #41 (внешний репорт 17.08): в ней было имя `xrayjson`, которого схема
 * хостов не знает, и сохранение с ним падало 400. Копия разошлась с сервером
 * молча, потому что разойтись ей было нечем помешать.
 *
 * Подпись берётся ПО ИМЕНИ из локалей: `hostEdit.formatName.<имя>`. Тест рядом
 * следит, что подпись есть у каждого имени из контракта, иначе новый формат
 * появился бы на экране голым идентификатором.
 */
export const HOST_FORMATS: readonly SubscriptionFormat[] = FORMAT_NAMES;

export function formatLabelKey(name: string): string {
  return `hostEdit.formatName.${name}`;
}

export function formatLabel(
  name: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  // Если подписи нет, показываем само имя: голый идентификатор честнее пустой
  // строки, и тест рядом всё равно не даст этому уехать в релиз.
  return t(formatLabelKey(name), { defaultValue: name });
}
