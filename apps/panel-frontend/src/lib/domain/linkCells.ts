import { LINK_CELL_ENGINES } from '@iceslab/shared';
import type { EngineName } from '@iceslab/shared';
import type { LinkCell } from '@/lib/domain/cascades';

/**
 * Какая ячейка ноги каким движком поднимается, по словам контракта.
 *
 * ⚠ Ответ «не знаю» остаётся третьим и после прихода таблицы: нода, которая ни
 * разу не отчиталась о ядрах, ничего про свои умения не сказала, и отказывать
 * ей нельзя. Ровно на таком выводе 2026-09-11 отказали 23 рабочим парам.
 *
 * Таблица приехала в `@iceslab/shared` 2026-09-22 (словарь ячеек), и временный
 * мост через каст пространства имён снят: теперь это обычный именованный
 * импорт, и расхождение состава поймает сборка, а не экран.
 */
type CellTable = Partial<Record<LinkCell, readonly EngineName[]>>;

const table: CellTable = LINK_CELL_ENGINES;

/**
 * Знает ли панель таблицу вообще.
 *
 * Аргумент остаётся: тесты подставляют свою таблицу, а `undefined` это всё ещё
 * законный вход, если однажды состав придёт не из контракта, а от сервера.
 */
export function cellTableKnown(source: CellTable | undefined = table): boolean {
  return source !== undefined;
}

/**
 * Движки, которыми поднимается эта ячейка, и `undefined`, когда ячейка чужая.
 *
 * Имя, которого в таблице нет, это не «ни один движок», а «панель про него не
 * знает»: молчание и отказ тут снова разные ответы.
 */
export function linkCellEngines(
  cell: string,
  source: CellTable | undefined = table,
): readonly EngineName[] | undefined {
  return source?.[cell as LinkCell];
}

/**
 * Несёт ли нода эту ячейку: `true`, `false` или `undefined`.
 *
 * `undefined` в двух случаях, и оба означают незнание, а не отказ: таблица
 * неизвестна, или нода ни разу не отчиталась о своих ядрах. Частичный факт
 * годится, чтобы сказать «да», и не годится, чтобы сказать «нет».
 */
export function nodeCarriesCell(
  node: { engines?: EngineName[]; cores?: { chainEngine?: EngineName } | null } | null | undefined,
  cell: string,
  source: CellTable | undefined = table,
): boolean | undefined {
  const engines = node?.engines;
  if (!engines) return undefined;
  const byTable = linkCellEngines(cell, source);
  if (!byTable) return undefined;
  // E46 (3962886, carriesCellAtSave): агент, который несёт ноги ТОЛЬКО цепью,
  // принимает ногу одним движком цепи. Таблица, где vless заканчивает и xray,
  // верна для агентов старше цепи, а не для этого.
  const chainEngine = node?.cores?.chainEngine;
  const carriers = chainEngine ? [chainEngine] : byTable;
  return carriers.some((e) => engines.includes(e));
}
