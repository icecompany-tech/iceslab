import * as shared from '@iceslab/shared';
import type { EngineName } from '@iceslab/shared';
import type { LinkCell } from '@/lib/domain/cascades';

/**
 * Какая ячейка ноги каким движком поднимается, по словам контракта.
 *
 * ⚠ Таблица приходит из `@iceslab/shared` и до фазы 5 её там НЕТ. Пока её нет,
 * все функции ниже отвечают `undefined`, и это третий ответ, а не «нет»:
 * сказать «нода не несёт hy2», не зная, каким движком hy2 вообще поднимается,
 * значит отказать по вычисленной величине. Ровно на этом 2026-09-11 отказали
 * 23 рабочим парам.
 *
 * Читается через `as`-каст пространства имён, а не именованным импортом,
 * потому что именованный импорт отсутствующего экспорта не собирается вовсе.
 * В тот день, когда контракт приедет, этот файл начнёт отвечать сам, без
 * правок здесь.
 */
type CellTable = Partial<Record<LinkCell, EngineName[]>>;

const table = (shared as unknown as { LINK_CELL_ENGINES?: CellTable }).LINK_CELL_ENGINES;

/** Знает ли панель таблицу вообще. `false` = фаза 5 ещё не доехала. */
export function cellTableKnown(source: CellTable | undefined = table): boolean {
  return source !== undefined;
}

/**
 * Движки, которыми поднимается эта ячейка, и `undefined`, когда таблицы нет.
 *
 * Две ячейки, `vless` и `shadowsocks`, панель умела собирать и до таблицы: они
 * строятся в конфиге xray (см. `cascade.config.ts` на бэкенде). Поэтому при
 * отсутствующей таблице они отвечают `['xray']`, а `hy2` и `tuic` молчат.
 */
export function linkCellEngines(
  cell: string,
  source: CellTable | undefined = table,
): EngineName[] | undefined {
  if (source) return source[cell as LinkCell];
  if (cell === 'vless' || cell === 'shadowsocks') return ['xray'];
  return undefined;
}

/**
 * Несёт ли нода эту ячейку: `true`, `false` или `undefined`.
 *
 * `undefined` в двух случаях, и оба означают незнание, а не отказ: таблица
 * неизвестна, или нода ни разу не отчиталась о своих ядрах. Частичный факт
 * годится, чтобы сказать «да», и не годится, чтобы сказать «нет».
 */
export function nodeCarriesCell(
  node: { engines?: EngineName[] } | null | undefined,
  cell: string,
  source: CellTable | undefined = table,
): boolean | undefined {
  const engines = node?.engines;
  if (!engines) return undefined;
  const carriers = linkCellEngines(cell, source);
  if (!carriers) return undefined;
  return carriers.some((e) => engines.includes(e));
}
