import { DEFAULT_FORMAT_NAMES, FORMAT_NAMES } from '@iceslab/shared';
import { describe, expect, it } from 'vitest';
import { DICT } from '@/contours/subscription/dict';
import { SRR_FORMATS } from '@/contours/subscription/lib/srrFormats';

describe('format lists', () => {
  it('a rule offers the whole contract', () => {
    expect([...SRR_FORMATS]).toEqual([...FORMAT_NAMES]);
  });

  it('the default format is the contract narrower list, the server replaces the rest with plain', () => {
    expect([...DEFAULT_FORMAT_NAMES].every((f) => (FORMAT_NAMES as readonly string[]).includes(f))).toBe(true);
    expect(DEFAULT_FORMAT_NAMES.length).toBeLessThan(FORMAT_NAMES.length);
  });

  it('every name of the contract has a label in both languages', () => {
    for (const locale of [DICT.ru, DICT.en]) {
      expect(FORMAT_NAMES.filter((n) => typeof (locale.formatNames as Record<string, string>)[n] !== 'string')).toEqual([]);
    }
  });
});
