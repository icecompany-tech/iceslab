import { describe, expect, it } from 'vitest';
import { FORMAT_NAMES } from '@iceslab/shared';
import { HOST_FORMATS, formatLabelKey } from '@/contours/hosts/lib/formats';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';

/**
 * Форматы подписки: список из контракта, подпись на каждое имя.
 *
 * Сторожит issue #41 (внешний репорт 17.08). Экран хоста держал СВОЙ список из
 * пяти имён, в нём было `xrayjson`, которого схема хостов не знает, и
 * сохранение с ним отвечало 400. Копия разошлась с сервером молча: ни сборка,
 * ни линт про это ничего сказать не могли.
 */

type Dict = Record<string, unknown>;

function label(dict: Dict, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Dict)?.[part], dict);
}

describe('форматы подписки на экране хоста', () => {
  it('1. список берётся из контракта, а не из копии на экране', () => {
    expect(HOST_FORMATS).toEqual([...FORMAT_NAMES]);
  });

  it('2. на экране все форматы контракта, а не пять из старой копии', () => {
    // Старая копия держала ровно эти пять, и восьми имён на экране не было
    // вовсе: выключить хост для wgconf или outline было нечем.
    for (const name of ['plain', 'singbox', 'xrayjson', 'xrayjson-array', 'clash']) {
      expect(HOST_FORMATS).toContain(name);
    }
    for (const name of ['json', 'wgconf', 'amneziavpn', 'xkeen', 'outline', 'surge', 'quantumultx', 'loon']) {
      expect(HOST_FORMATS).toContain(name);
    }
    expect(HOST_FORMATS.length).toBeGreaterThan(5);
  });

  it('3. у каждого имени из контракта есть русская подпись', () => {
    const missing = FORMAT_NAMES.filter((n) => typeof label(ru as Dict, formatLabelKey(n)) !== 'string');
    expect(missing).toEqual([]);
  });

  it('4. у каждого имени из контракта есть английская подпись', () => {
    const missing = FORMAT_NAMES.filter((n) => typeof label(en as Dict, formatLabelKey(n)) !== 'string');
    expect(missing).toEqual([]);
  });

  it('5. лишних подписей нет: словарь не переживает удалённый формат', () => {
    const dict = label(ru as Dict, 'hostEdit.formatName') as Dict;
    expect(Object.keys(dict).sort()).toEqual([...FORMAT_NAMES].sort());
  });
});
