import { describe, expect, it } from 'vitest';
import {
  awgLabel,
  nodeAwgFact,
  profileAwgCreate,
  profileAwgGeneration,
  profileAwgPatch,
} from '@/lib/domain/awg';

describe('nodeAwgFact: факт модуля на ноде (227054e)', () => {
  it('3: модуль 3.1, несёт 1.x и 3.1', () => {
    expect(nodeAwgFact(3)).toBe('awg3');
  });

  it('1: модуль 1.x, только 1.x', () => {
    expect(nodeAwgFact(1)).toBe('awg1');
  });

  it('null: не сообщено, как 1 не читается', () => {
    expect(nodeAwgFact(null)).toBe('unreported');
  });

  it('undefined: сервер поля не отдаёт, строки нет', () => {
    expect(nodeAwgFact(undefined)).toBeNull();
  });

  it('подпись поколения', () => {
    expect(awgLabel(3)).toBe('3.1');
    expect(awgLabel(1)).toBe('1.x');
  });
});

describe('поколение профиля: выбор, null = 1', () => {
  it('null и нет ключа читаются как 1', () => {
    expect(profileAwgGeneration(null)).toBe(1);
    expect(profileAwgGeneration(undefined)).toBe(1);
    expect(profileAwgGeneration(3)).toBe(3);
  });

  it('PUT: только при смене; на 3 уходит 3, назад на 1 уходит null', () => {
    expect(profileAwgPatch(null, 1)).toEqual({});
    expect(profileAwgPatch(3, 3)).toEqual({});
    expect(profileAwgPatch(null, 3)).toEqual({ awgProtocol: 3 });
    expect(profileAwgPatch(1, 3)).toEqual({ awgProtocol: 3 });
    expect(profileAwgPatch(3, 1)).toEqual({ awgProtocol: null });
  });

  it('PUT: сервер поля не знает, ключа нет даже при выборе', () => {
    expect('awgProtocol' in profileAwgPatch(undefined, 3)).toBe(false);
  });

  it('POST: только 3, 1.x это умолчание', () => {
    expect(profileAwgCreate(1)).toEqual({});
    expect(profileAwgCreate(3)).toEqual({ awgProtocol: 3 });
  });
});
