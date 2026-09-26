import { describe, expect, it } from 'vitest';
import { awgGenerationsKnown } from '@/lib/domain/nodeFields';
import {
  agentAwgFact,
  awgGenerationBadge,
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

describe('agentAwgFact: что несёт агент (cores[].awgGenerations, 24b59b9)', () => {
  it('сервер поля не отдаёт: строки нет, что бы ни лежало', () => {
    expect(agentAwgFact(false, [1, 3])).toBeNull();
  });

  it('[1, 3]: интерфейсы 1.x и 3.1', () => {
    expect(agentAwgFact(true, [1, 3])).toBe('both');
  });

  it('[1] или нет ключа: только 1.x, пересобрать (отсутствие здесь ответ)', () => {
    expect(agentAwgFact(true, [1])).toBe('only1');
    expect(agentAwgFact(true, undefined)).toBe('only1');
    expect(agentAwgFact(true, 'junk')).toBe('only1');
  });
});

describe('awgGenerationsKnown: вложенный ключ по fields или по строкам ядер', () => {
  const node = (cores: object[]) => ({ cores: { observedAt: '', cores } }) as never;
  it('fields сервера называет ключ: знает и на пустом парке', () => {
    expect(awgGenerationsKnown({ nodes: [], fields: ['cores[].awgGenerations'] })).toBe(true);
  });
  it('сервер старше fields: по строке ядра с ключом', () => {
    expect(awgGenerationsKnown({ nodes: [node([{ name: 'amneziawg', awgGenerations: [1] }])] })).toBe(true);
    expect(awgGenerationsKnown({ nodes: [node([{ name: 'amneziawg' }])] })).toBe(false);
    expect(awgGenerationsKnown(undefined)).toBe(false);
  });
});

describe('awgGenerationBadge: значок только у профиля AmneziaWG 3.1', () => {
  it('3.1 да; 1.x, null, другой протокол, нет профиля: нет', () => {
    expect(awgGenerationBadge({ protocol: 'amneziawg', awgProtocol: 3 })).toBe('3.1');
    expect(awgGenerationBadge({ protocol: 'amneziawg', awgProtocol: 1 })).toBeNull();
    expect(awgGenerationBadge({ protocol: 'amneziawg', awgProtocol: null })).toBeNull();
    expect(awgGenerationBadge({ protocol: 'xray', awgProtocol: 3 })).toBeNull();
    expect(awgGenerationBadge(undefined)).toBeNull();
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
