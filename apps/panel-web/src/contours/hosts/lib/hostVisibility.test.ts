import { describe, expect, it } from 'vitest';
import { HOST_SERVER_DESCRIPTION_MAX } from '@iceslab/shared';
import { serverDescriptionRefusal } from '@/lib/old/hosts';
import { descriptionProblem, hiddenByOperator, visibilityKnown, visibilityPatch } from '@/contours/hosts/lib/hostVisibility';

describe('описание и «скрыт» хоста (A-236 шаг 6)', () => {
  it('1. сервер без полей: ни поля, ни ключа; на новом хосте судим по списку', () => {
    expect(visibilityKnown(false, { isHidden: false }, undefined)).toBe(true);
    expect(visibilityKnown(false, {}, undefined)).toBe(false);
    expect(visibilityKnown(false, null, undefined)).toBe(false);
    expect(visibilityKnown(true, null, [{ isHidden: true }, { isHidden: false }])).toBe(true);
    expect(visibilityKnown(true, null, [{ isHidden: true }, {}])).toBe(false);
    expect(visibilityKnown(true, null, [])).toBe(true);
    expect(visibilityKnown(true, null, undefined)).toBe(false);
  });

  it('2. проверка поля по общему правилу; пустое поле это «стереть», а не ошибка', () => {
    expect(descriptionProblem('')).toBeNull();
    expect(descriptionProblem('   ')).toBe('empty');
    expect(descriptionProblem('fast\nlane')).toBe('multiline');
    expect(descriptionProblem('😀'.repeat(HOST_SERVER_DESCRIPTION_MAX))).toBeNull();
    expect(descriptionProblem('😀'.repeat(HOST_SERVER_DESCRIPTION_MAX + 1))).toBe('too-long');
  });

  it('3. правка шлёт ключ только при изменении; стереть это null, пустая строка не уходит', () => {
    const stored = { serverDescription: 'fast', isHidden: false };
    expect(visibilityPatch(stored, 'fast', false)).toEqual({});
    expect(visibilityPatch(stored, '', false)).toEqual({ serverDescription: null });
    expect(visibilityPatch(stored, 'video', true)).toEqual({ serverDescription: 'video', isHidden: true });
    expect(visibilityPatch({ serverDescription: null, isHidden: true }, '', true)).toEqual({});
  });

  it('4. новый хост шлёт только заданное', () => {
    expect(visibilityPatch(null, '', false)).toEqual({});
    expect(visibilityPatch(null, 'fast', true)).toEqual({ serverDescription: 'fast', isHidden: true });
  });

  it('5. пометка «скрыт» в списке только при true, отсутствие ключа не «скрыт»', () => {
    expect(hiddenByOperator({ isHidden: true })).toBe(true);
    expect(hiddenByOperator({ isHidden: false })).toBe(false);
    expect(hiddenByOperator({})).toBe(false);
  });

  it('6. отказ сервера у поля словами issues[].message; прочее не он', () => {
    const r = (status: number, data: unknown) => ({ response: { status, data } });
    const words = 'serverDescription is one line: a line break or a control character is not allowed';
    expect(
      serverDescriptionRefusal(r(400, { error: 'VALIDATION_ERROR', issues: [{ path: ['remark'], message: 'x' }, { path: ['serverDescription'], message: words }] })),
    ).toBe(words);
    expect(serverDescriptionRefusal(r(400, { error: 'VALIDATION_ERROR', issues: [{ path: ['remark'], message: 'x' }] }))).toBeNull();
    expect(serverDescriptionRefusal(r(409, { error: 'VALIDATION_ERROR', issues: [{ path: ['serverDescription'], message: words }] }))).toBeNull();
    expect(serverDescriptionRefusal(null)).toBeNull();
  });
});
