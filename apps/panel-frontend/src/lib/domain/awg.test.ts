import { describe, expect, it } from 'vitest';
import {
  awgClientHint,
  awgPayload,
  awgRuntimeNoteShown,
  readCoreAwg,
  awgSelectorShown,
  awgVersionFacts,
} from '@/lib/domain/awg';

describe('awgClientHint', () => {
  it('1. версия 1: подсказка про клиенты 1.x и роутеры', () => {
    expect(awgClientHint(1)).toBe('awgHint1');
  });

  it('2. версия 3: подсказка про AmneziaVPN 5.0.1.5 и несовместимость', () => {
    expect(awgClientHint(3)).toBe('awgHint3');
  });

  it('3. null: не задана, читается как 1, так живут ноды до фазы 7', () => {
    expect(awgClientHint(null)).toBe('awgHint1');
  });

  it('4. undefined: сервер поля не знает, подсказки нет', () => {
    expect(awgClientHint(undefined)).toBeNull();
  });
});

describe('awgRuntimeNoteShown', () => {
  it('1. версия 3 и сервер отдаёт awgRuntime: строка есть', () => {
    expect(awgRuntimeNoteShown(3, 'userspace')).toBe(true);
    expect(awgRuntimeNoteShown(3, null)).toBe(true);
  });

  it('2. awgRuntime ещё не приходит (до фазы 7): строки нет', () => {
    expect(awgRuntimeNoteShown(3, undefined)).toBe(false);
  });

  it('3. версия 1 и не задана: строки нет', () => {
    expect(awgRuntimeNoteShown(1, 'kernel')).toBe(false);
    expect(awgRuntimeNoteShown(null, 'kernel')).toBe(false);
  });
});

describe('awgSelectorShown', () => {
  it('1. сервер поля не знает: выбора нет даже у AWG-ноды', () => {
    expect(awgSelectorShown(false, 'amneziawg', [])).toBe(false);
  });

  it('2. основной протокол amneziawg: выбор есть', () => {
    expect(awgSelectorShown(true, 'amneziawg', null)).toBe(true);
  });

  it('3. нода xray, но ядро amneziawg занято профилем: выбор есть', () => {
    expect(awgSelectorShown(true, 'xray', [{ name: 'amneziawg', provisioned: true }])).toBe(true);
  });

  it('4. нода xray, ядро amneziawg свободно или молчит: выбора нет', () => {
    expect(awgSelectorShown(true, 'xray', [{ name: 'amneziawg', provisioned: false }])).toBe(false);
    expect(awgSelectorShown(true, 'xray', [{ name: 'amneziawg' }])).toBe(false);
  });
});

describe('awgPayload', () => {
  it('1. сервер поля не знает: ключа нет даже после выбора', () => {
    expect('awgProtocol' in awgPayload(false, true, 3)).toBe(false);
  });

  it('2. оператор не трогал: ключа нет', () => {
    expect('awgProtocol' in awgPayload(true, false, 3)).toBe(false);
  });

  it('3. знает и правил: уходит выбранное', () => {
    expect(awgPayload(true, true, 3)).toEqual({ awgProtocol: 3 });
  });
});

describe('readCoreAwg', () => {
  it('1. поля ещё не приехали: undefined, а не «не сообщено»', () => {
    expect(readCoreAwg({ name: 'amneziawg', version: '1.0.20260611' })).toEqual({
      reported: undefined,
      runtime: undefined,
    });
  });

  it('2. приехали: читаются как есть', () => {
    expect(readCoreAwg({ awgProtocol: 3, runtime: 'userspace' })).toEqual({ reported: 3, runtime: 'userspace' });
    expect(readCoreAwg({ awgProtocol: null, runtime: null })).toEqual({ reported: null, runtime: null });
  });

  it('3. незнакомые значения не выдаются за поколение', () => {
    expect(readCoreAwg({ awgProtocol: 2, runtime: 'docker' })).toEqual({ reported: undefined, runtime: undefined });
  });
});

describe('awgVersionFacts', () => {
  const none = { reported: undefined, runtime: undefined };

  it('1. задано и поднято одно, модулем ядра: расхождения нет', () => {
    expect(awgVersionFacts(1, { reported: 1, runtime: 'kernel' })).toEqual({
      intended: 1, reported: 1, runtime: 'kernel', mismatch: false,
    });
  });

  it('2. задано 3.1, интерфейс поднят как 1.x: расхождение', () => {
    expect(awgVersionFacts(3, { reported: 1, runtime: 'kernel' })).toMatchObject({ mismatch: true });
  });

  it('3. ядро о себе ещё не сообщило: только намерение, без янтаря', () => {
    expect(awgVersionFacts(3, none)).toEqual({ intended: 3, reported: null, runtime: null, mismatch: false });
  });

  it('4. null у ноды читается как 1, и против 3.1 на интерфейсе это расхождение', () => {
    expect(awgVersionFacts(null, { reported: 3, runtime: 'userspace' })).toMatchObject({ intended: 1, mismatch: true });
  });

  it('5. сервер намерение не отдаёт: строка молчит целиком', () => {
    expect(awgVersionFacts(undefined, { reported: 3, runtime: 'userspace' })).toBeNull();
  });
});
