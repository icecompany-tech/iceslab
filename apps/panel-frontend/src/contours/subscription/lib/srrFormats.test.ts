import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_NAMES, FORMAT_NAMES } from '@iceslab/shared';
import { SRR_FORMATS } from '@/contours/subscription/lib/srrFormats';
import { HOST_FORMATS, formatLabelKey } from '@/lib/domain/formats';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';

/**
 * Три экрана называют форматы подписки, и список у них ОДИН.
 *
 * До 2026-09-22 их было четыре, и все четыре разные: хост знал пять имён,
 * настройка «по умолчанию» свои пять, правило выдачи одиннадцать, контракт
 * тринадцать. Каждая копия расходилась молча, а расплачивался оператор: то 400
 * на сохранении, то формат, которого на экране просто нет.
 */

type Dict = Record<string, unknown>;

function label(dict: Dict, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Dict)?.[part], dict);
}

describe('списки форматов на панели', () => {
  it('1. правило выдачи предлагает весь контракт', () => {
    expect([...SRR_FORMATS]).toEqual([...FORMAT_NAMES]);
  });

  it('2. правило теперь знает xrayjson-array и amneziavpn: их и не хватало', () => {
    expect(SRR_FORMATS).toContain('xrayjson-array');
    expect(SRR_FORMATS).toContain('amneziavpn');
  });

  it('3. «формат по умолчанию» это СВОЙ, более узкий список контракта', () => {
    // Узкий он не по недосмотру: сервер принимает в настройке только эти и
    // молча заменяет остальное на plain. Предлагать больше значит врать.
    expect([...DEFAULT_FORMAT_NAMES].every((f) => (FORMAT_NAMES as readonly string[]).includes(f))).toBe(true);
    expect(DEFAULT_FORMAT_NAMES.length).toBeLessThan(FORMAT_NAMES.length);
  });

  it('4. у каждого имени из обоих списков есть подпись, и словарь один', () => {
    const names = new Set<string>([...FORMAT_NAMES, ...DEFAULT_FORMAT_NAMES, ...HOST_FORMATS]);
    const missingRu = [...names].filter((n) => typeof label(ru as Dict, formatLabelKey(n)) !== 'string');
    const missingEn = [...names].filter((n) => typeof label(en as Dict, formatLabelKey(n)) !== 'string');
    expect(missingRu).toEqual([]);
    expect(missingEn).toEqual([]);
  });
});
