import { describe, expect, it } from 'vitest';
import { FORMAT_NAMES, formatCarries, type Door } from '@iceslab/shared';
import { HOST_FORMATS, formatLabelKey, hostFormatFacts, type ProfileFormats } from '@/lib/domain/formats';
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
    // Словарь ОБЩИЙ на панель, поэтому и проверяется по общему ключу.
    const dict = label(ru as Dict, 'formatName') as Dict;
    expect(Object.keys(dict).sort()).toEqual([...FORMAT_NAMES].sort());
  });
});

describe('hostFormatFacts: три состояния формата на хосте', () => {
  // Ответ сервера строится тем же formatCarries, что и выдача подписки.
  const answer = (door: Door, layer?: 'default' | 'tls' | 'none'): ProfileFormats => ({
    door,
    formats: FORMAT_NAMES.map((format) => ({ format, ...formatCarries(format, door, layer) })),
  });

  it('без контракта (старый сервер): прежний список, только вкл/выкл, без счёта', () => {
    const f = hostFormatFacts(null, ['clash']);
    expect(f.counts).toBeNull();
    expect(f.rows.map((r) => r.state)).toEqual(FORMAT_NAMES.map((n) => (n === 'clash' ? 'off' : 'on')));
  });

  it('AmneziaWG: несут ровно те, кого считает контракт, остальные с причиной', () => {
    const f = hostFormatFacts(answer('amneziawg'), []);
    const carried = FORMAT_NAMES.filter((n) => formatCarries(n, 'amneziawg').carried);
    expect(f.counts).toEqual({ carried: carried.length, total: FORMAT_NAMES.length, off: 0 });
    for (const r of f.rows) {
      if (r.state === 'cannot') expect(['client-lacks-protocol', 'no-uri-standard', 'not-yet']).toContain(r.why);
    }
  });

  it('выключенный оператором несущий формат считается отдельно, не несущий остаётся «не может»', () => {
    const cannot = FORMAT_NAMES.find((n) => !formatCarries(n, 'amneziawg').carried)!;
    const carries = FORMAT_NAMES.find((n) => formatCarries(n, 'amneziawg').carried)!;
    const f = hostFormatFacts(answer('amneziawg'), [cannot, carries]);
    expect(f.rows.find((r) => r.format === carries)?.state).toBe('off');
    expect(f.rows.find((r) => r.format === cannot)?.state).toBe('cannot');
    expect(f.counts?.off).toBe(1);
  });

  it('формат, про который сервер промолчал, не выдаётся за «не несёт»', () => {
    const partial: ProfileFormats = { door: 'vless', formats: [] };
    expect(hostFormatFacts(partial, []).rows.every((r) => r.state === 'on')).toBe(true);
  });
});
