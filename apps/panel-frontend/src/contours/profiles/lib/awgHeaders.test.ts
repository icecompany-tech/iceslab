import { describe, expect, it } from 'vitest';
import type { Profile } from '@/lib/domain/profiles';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import {
  AWG_H_FIELDS,
  AWG_H_MIN,
  awgHeaderConfig,
  awgHeaderProblems,
  awgHeaderRefusal,
} from '@/contours/profiles/lib/awgHeaders';

const h = (h1: number | '', h2: number | '', h3: number | '', h4: number | '') => ({
  awgH1: h1,
  awgH2: h2,
  awgH3: h3,
  awgH4: h4,
});
const res = (status: number, data: unknown) => ({ response: { status, data } });

describe('засев H1..H4 (A-286)', () => {
  it('новый профиль: четыре разных H не меньше 5', () => {
    for (let i = 0; i < 50; i++) {
      const v = defaults(null);
      const hs = AWG_H_FIELDS.map((f) => v[f]);
      for (const x of hs) {
        expect(typeof x).toBe('number');
        expect(x as number).toBeGreaterThanOrEqual(AWG_H_MIN);
      }
      expect(new Set(hs).size).toBe(4);
      expect(awgHeaderProblems(v).size).toBe(0);
    }
  });

  it('правка: хранимое как есть, без случайных', () => {
    const stored = { subnet: '10.66.66.0/24', obfuscation: { h1: 11, h2: 12, h3: 13, h4: 14 } };
    const v = defaults({ id: 'p', protocol: 'amneziawg', name: 'a', config: stored } as unknown as Profile);
    expect(AWG_H_FIELDS.map((f) => v[f])).toEqual([11, 12, 13, 14]);
  });
});

describe('awgHeaderProblems: валидатор до запроса', () => {
  it('пустое и меньше 5: своё поле', () => {
    expect([...awgHeaderProblems(h('', 10, 11, 12))]).toEqual(['awgH1']);
    expect([...awgHeaderProblems(h(10, 4, 11, 12))]).toEqual(['awgH2']);
    expect([...awgHeaderProblems(h(10, 11, 0, 12))]).toEqual(['awgH3']);
    expect([...awgHeaderProblems(h(10, 11, 12, 12.5))]).toEqual(['awgH4']);
  });
  it('граница: 5 проходит, 4 отказ', () => {
    expect(awgHeaderProblems(h(5, 6, 7, 8)).size).toBe(0);
    expect(awgHeaderProblems(h(4, 6, 7, 8)).has('awgH1')).toBe(true);
  });
  it('совпадающие: оба поля пары', () => {
    expect([...awgHeaderProblems(h(10, 20, 10, 30))].sort()).toEqual(['awgH1', 'awgH3']);
  });
});

describe('awgHeaderConfig: 0 не уходит никогда', () => {
  it('заполненное как есть, пустое не уходит', () => {
    expect(awgHeaderConfig(h(10, 20, 30, 40))).toEqual({ h1: 10, h2: 20, h3: 30, h4: 40 });
    expect(awgHeaderConfig(h('', 20, '', 40))).toEqual({ h2: 20, h4: 40 });
    expect(Object.values(awgHeaderConfig(h('', '', '', '')))).not.toContain(0);
  });
});

describe('awgHeaderRefusal: отказ сервера у поля по path', () => {
  const issue = (field: unknown, code = 'too_small') => ({ code, path: ['config', 'obfuscation', field], message: 'm' });
  it('too_small и pairwise distinct: поля по порядку, без повторов', () => {
    const err = res(400, {
      error: 'VALIDATION_ERROR',
      issues: [issue('h3', 'custom'), issue('h1'), issue('h3'), { path: ['config', 'subnet'] }],
    });
    expect(awgHeaderRefusal(err)).toEqual(['awgH1', 'awgH3']);
  });
  it('не тот отказ или кривой вход: пусто', () => {
    expect(awgHeaderRefusal(res(400, { error: 'VALIDATION_ERROR', issues: [issue('constructor'), issue('jc')] }))).toEqual([]);
    expect(awgHeaderRefusal(res(409, { error: 'VALIDATION_ERROR', issues: [issue('h1')] }))).toEqual([]);
    expect(awgHeaderRefusal(res(400, { error: 'INVALID', issues: [issue('h1')] }))).toEqual([]);
    expect(awgHeaderRefusal(res(400, { error: 'VALIDATION_ERROR', issues: [null, 'x', { path: ['obfuscation', 'h1'] }] }))).toEqual([]);
    for (const e of [null, undefined, 'x', {}, { response: null }, res(400, null)]) expect(awgHeaderRefusal(e)).toEqual([]);
  });
});
