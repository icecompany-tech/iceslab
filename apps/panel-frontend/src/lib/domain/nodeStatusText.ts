/**
 * Сообщение статуса ноды (`lastStatusMessage`) для человека, с переводом
 * известных фраз агента. Строка для чтения, а не факт: экран по ней ничего
 * не решает (см. chainStatus.ts), только заменяет английскую фразу русской и
 * оставляет остальное как есть.
 *
 * Фразы по вхождению подстроки, потому что сервер ставит причину первой и
 * добавляет хвост: «system resolver not answering; not running: …» (ca44e5f).
 */
const PHRASES: readonly (readonly [english: string, key: string])[] = [
  ['system resolver not answering', 'nodeCard.statusPhrase.resolverDown'],
];

/**
 * Повторяет ли причина статуса то, что карточка уже говорит блоком «Отказ
 * ядра» (E38): у недоступной ноды оба говорят «fetch failed». Сравнение по
 * сырому тексту без лишних пробелов, с причиной отказа и с его полным
 * текстом. При различии показываются оба.
 */
export function statusRepeatsRefusal(
  message: string | null | undefined,
  refusal: { reason: string; full: string } | null | undefined,
): boolean {
  if (typeof message !== 'string' || !refusal) return false;
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const m = flat(message);
  return m !== '' && (m === flat(refusal.reason) || m === flat(refusal.full));
}

export function nodeStatusText(
  message: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (text === '') return null;
  return PHRASES.reduce((acc, [en, key]) => acc.split(en).join(t(key)), text);
}
