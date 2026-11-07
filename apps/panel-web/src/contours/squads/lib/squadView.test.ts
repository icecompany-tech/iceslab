import { describe, expect, it } from 'vitest';
import { cardCountries, sectionState } from '@/contours/squads/lib/squadView';

const ok = (data: unknown = {}) => ({ data, isError: false });
const failed = { data: undefined, isError: true };
const pending = { data: undefined, isError: false };

describe('sectionState (A-239, a)', () => {
  it('сбой списка секции: сбой с индексом списка, а не «нет профилей»', () => {
    expect(sectionState([failed], 0)).toEqual({ kind: 'failed', index: 0 });
    expect(sectionState([ok(), pending, failed], 0)).toEqual({ kind: 'failed', index: 2 });
  });

  it('ожидание любого списка: загрузка', () => {
    expect(sectionState([ok(), pending], 0)).toEqual({ kind: 'loading' });
  });

  it('«нет» только когда все списки пришли и секция пуста', () => {
    expect(sectionState([ok(), ok()], 0)).toEqual({ kind: 'empty' });
    expect(sectionState([ok()], 3)).toEqual({ kind: 'list' });
  });
});

describe('cardCountries (A-239, b)', () => {
  it('страны только при обоих пришедших списках, иначе null («-»)', () => {
    expect(cardCountries(['DE'], ok(), ok())).toEqual(['DE']);
    expect(cardCountries([], ok(), ok())).toEqual([]);
    expect(cardCountries([], failed, ok())).toBeNull();
    expect(cardCountries([], ok(), pending)).toBeNull();
  });
});
