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

export function nodeStatusText(
  message: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (text === '') return null;
  return PHRASES.reduce((acc, [en, key]) => acc.split(en).join(t(key)), text);
}
