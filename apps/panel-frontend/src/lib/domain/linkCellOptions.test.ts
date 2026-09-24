import { describe, expect, it } from 'vitest';
import { LINK_CELLS } from '@iceslab/shared';
import { isRealisedLinkCell, legCellName, linkCellOptions } from '@/lib/domain/engines';

/**
 * Список ячеек у селектора ноги.
 *
 * Селектор ОДИН на ногу позиции и ногу направления, и копия списка здесь стоила
 * дороже, чем выглядела: `lib/domain/engines.ts` объявлял свой `LINK_CELLS` из
 * двух значений, имя совпадало с контрактным из четырёх, и нога позиции молча
 * предлагала половину. Разрез 5 фазы 5 (цепь `xray-вход -> hy2 -> tuic -> ss ->
 * выход`) в панели из-за этого не собирался, хотя сервер такую цепь принимает.
 *
 * Поэтому тест сверяется с контрактом, а не с четвёркой значений: своя
 * четвёрка была бы новой копией.
 */
const label = (t: string) => t;

describe('linkCellOptions', () => {
  it('1. предлагаются ВСЕ ячейки контракта', () => {
    const values = linkCellOptions(null, label).map((o) => o.value);
    expect(values).toEqual([...LINK_CELLS]);
  });

  it('2. подпись это имя ячейки, без движка: ногу рисует цепь, не xray', () => {
    const byValue = new Map(linkCellOptions(null, label).map((o) => [o.value, o.label]));
    expect(byValue.get('vless')).toBe('VLESS');
    expect(byValue.get('shadowsocks')).toBe('Shadowsocks');
    expect(byValue.get('hy2')).toBe('hy2');
    expect(byValue.get('tuic')).toBe('tuic');
    for (const l of byValue.values()) expect(l).not.toMatch(/ядро|engine\./);
    expect(legCellName('xray')).toBe('VLESS');
  });

  it('3. хранимое `xray` это ячейка vless: остаётся в списке, когда оно выбрано', () => {
    expect(linkCellOptions('xray', label).map((o) => o.value)).toContain('xray');
    expect(isRealisedLinkCell('xray')).toBe(true);
    // Если выбрано не оно, лишней строки в списке нет.
    expect(linkCellOptions('hy2', label).map((o) => o.value)).not.toContain('xray');
  });

  it('5. каждая ячейка контракта считается РАБОЧЕЙ', () => {
    // На этом стоит блокировка сохранения: экран правки считает «устаревшим»
    // всё, что не реализовано, и гасит кнопку. Пока список был из двух ячеек,
    // проверка ноги шла по списку ПРОТОКОЛОВ и совпадала с ним случайно, а
    // `hy2` и `tuic` объявлялись мусором и не давали сохранить живой каскад.
    for (const cell of LINK_CELLS) expect(isRealisedLinkCell(cell)).toBe(true);
  });

  it('4. чужое сохранённое значение видно, а не заменено пустотой', () => {
    const options = linkCellOptions('hysteria', label);
    expect(options.map((o) => o.value)).toContain('hysteria');
    expect(isRealisedLinkCell('hysteria')).toBe(false);
  });
});
