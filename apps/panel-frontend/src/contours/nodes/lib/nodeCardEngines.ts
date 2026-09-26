import { ENGINE_NAMES, type EngineName, type NodeCoreInfo } from '@iceslab/shared';

/**
 * Ядра ноды на карточке списка (E44, 26.09): все ядра, а не версия одного
 * xray. Короткие имена, чтобы строка жила в углу карточки; полные имена и
 * версии уходят в подсказку.
 */
export const ENGINE_SHORT: Record<EngineName, string> = {
  xray: 'xray',
  hysteria: 'hy2',
  singbox: 'sb',
  amneziawg: 'awg',
  naive: 'naive',
  mieru: 'mieru',
  mtproto: 'mtg',
};

const ENGINE_FULL: Record<EngineName, string> = {
  xray: 'xray',
  hysteria: 'hysteria',
  singbox: 'sing-box',
  amneziawg: 'amneziawg',
  naive: 'naive',
  mieru: 'mieru',
  mtproto: 'mtproto',
};

/** Ядра намерения в порядке ENGINE_NAMES, как бы список ни хранился. */
export function cardEngines(engines: readonly EngineName[]): EngineName[] {
  return ENGINE_NAMES.filter((e) => engines.includes(e));
}

/** Разделитель между именами в строке карточки, в знаках. */
const SEP = 1;

/**
 * Сколько имён влезает в `maxChars` знаков моноширинного шрифта, с хвостом
 * «+N» за невлезшие. Имя либо целиком, либо никак: обрезка посередине дала бы
 * «hy» или «nai», которые читаются как другие ядра. Ширина неизвестна
 * (`maxChars` не число или не больше нуля, первый кадр до замера): показать
 * всё, недосчитанное место лучше выдуманного «+N».
 */
export function fitEngineNames(names: readonly string[], maxChars: number): { shown: string[]; rest: number } {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return { shown: [...names], rest: 0 };
  for (let k = names.length; k >= 0; k--) {
    const rest = names.length - k;
    const body = names.slice(0, k).reduce((sum, n, i) => sum + n.length + (i > 0 ? SEP : 0), 0);
    const tail = rest > 0 ? `+${rest}`.length + (k > 0 ? SEP : 0) : 0;
    if (body + tail <= maxChars) return { shown: names.slice(0, k), rest };
  }
  return { shown: [], rest: names.length };
}

/**
 * Строки подсказки: по ядру на строку, полное имя и версия из отчёта ноды
 * (`cores[]`). Строк у одного ядра бывает несколько (xray[xray] и
 * shadowsocks[xray]), берётся первая с версией. Версии нет: `null` на месте
 * версии, слова решает экран. У amneziawg версия модуля и отдельно утилит.
 */
export function engineVersionLines(
  engines: readonly EngineName[],
  cores: readonly NodeCoreInfo[] | undefined,
): { engine: string; version: string | null }[] {
  return cardEngines(engines).map((e) => {
    const row = cores?.find((c) => c.engine === e && (c.version || c.toolsVersion));
    const version = row
      ? [row.version, row.toolsVersion && row.toolsVersion !== row.version ? `tools ${row.toolsVersion}` : null]
          .filter(Boolean)
          .join(', ') || null
      : null;
    return { engine: ENGINE_FULL[e], version };
  });
}
