import { describe, expect, it } from 'vitest';
import { accessNoteKey, accessOutcome, bulkReport, storedAccessFacts } from '@/contours/users/lib/userAccess';
import { defaultValues, userUpdatePatch } from '@/contours/users/lib/userForm';
import type { User } from '@/lib/domain/users';

const now = new Date('2026-11-01T12:00:00Z');
const past = new Date('2026-10-01T00:00:00Z');
const later = new Date('2026-12-01T00:00:00Z');
const GiB = 1_073_741_824;

describe('A-294: доступ юзера в дровере', () => {
  it('отключить можно любого: истёкшего и упёршегося в лимит тоже', () => {
    expect(accessOutcome('disabled', { expiresAt: past, limitBytes: null, usedBytes: 0 }, now)).toBe('disabled');
    expect(accessOutcome('disabled', { expiresAt: null, limitBytes: GiB, usedBytes: 2 * GiB }, now)).toBe('disabled');
  });

  it('«включён» истёкшему не обещает подписку: он остаётся истёкшим, пока срок в прошлом', () => {
    const outcome = accessOutcome('active', { expiresAt: past, limitBytes: null, usedBytes: 0 }, now);
    expect(outcome).toBe('expired');
    expect(accessNoteKey('active', outcome)).toBe('accessExpiredNote');
    expect(accessNoteKey('disabled', outcome)).toBe('accessExpiredNote');
  });

  it('«включён» при исчерпанном трафике остаётся «лимит», пока трафик не сброшен или лимит не выше', () => {
    const outcome = accessOutcome('active', { expiresAt: null, limitBytes: GiB, usedBytes: GiB }, now);
    expect(outcome).toBe('limited');
    expect(accessNoteKey('active', outcome)).toBe('accessLimitedNote');
    expect(accessOutcome('active', { expiresAt: null, limitBytes: 5 * GiB, usedBytes: GiB }, now)).toBe('active');
  });

  it('продление в той же правке снимает «истёк»: считается срок формы', () => {
    expect(accessOutcome('active', { expiresAt: later, limitBytes: null, usedBytes: 0 }, now)).toBe('active');
  });

  it('строка под выбором: отключение называет, что перестанет работать; уже отключённому и включённому молчит', () => {
    expect(accessNoteKey('active', 'disabled')).toBe('accessDisableNote');
    expect(accessNoteKey('disabled', 'disabled')).toBeNull();
    expect(accessNoteKey('disabled', 'active')).toBeNull();
    expect(accessNoteKey('active', 'active')).toBeNull();
  });

  it('факты хранимого юзера: дата строкой в Date, лимит и потраченное как есть', () => {
    expect(
      storedAccessFacts({ expireAt: '2026-10-01T00:00:00.000Z', trafficLimitBytes: 300 * 1_048_576, trafficUsedBytes: 7 }),
    ).toEqual({ expiresAt: past, limitBytes: 300 * 1_048_576, usedBytes: 7 });
  });
});

describe('A-294: PUT несёт status только при изменении', () => {
  const user = {
    username: 'bob',
    status: 'expired',
    trafficLimitBytes: null,
    trafficLimitStrategy: 'no_reset',
    groupIds: [],
    routingPreset: null,
  } as unknown as User;

  it('истёкший засевается как «включён»; сохранение без касания статуса его не шлёт', () => {
    const seed = defaultValues(user);
    expect(seed.status).toBe('active');
    expect(userUpdatePatch(seed, { ...seed, description: 'x' }, null)).toEqual({ description: 'x' });
  });

  it('отключили: уходит disabled; отключили и вернули назад: не уходит ничего', () => {
    const seed = defaultValues(user);
    expect(userUpdatePatch(seed, { ...seed, status: 'disabled' }, null)).toEqual({ status: 'disabled' });
    expect(userUpdatePatch(seed, { ...seed, status: 'active' }, null)).toEqual({});
  });

  it('отключённого включили: уходит active, а куда он ляжет, решает сервер по фактам', () => {
    const seed = defaultValues({ ...user, status: 'disabled' } as User);
    expect(seed.status).toBe('disabled');
    expect(userUpdatePatch(seed, { ...seed, status: 'active' }, null)).toEqual({ status: 'active' });
  });
});

describe('A-294: отчёт POST /api/users/bulk', () => {
  it('читается целиком: счётчики, дошедшие, отказы словами сервера', () => {
    expect(
      bulkReport({
        action: 'disable',
        requested: 3,
        succeeded: 2,
        ok: ['a', 'b'],
        failed: [{ userId: 'c', error: 'User not found: c' }],
      }),
    ).toEqual({ requested: 3, succeeded: 2, ok: ['a', 'b'], failed: [{ userId: 'c', error: 'User not found: c' }] });
  });

  it('чужая форма это null, а не нули', () => {
    expect(bulkReport(null)).toBeNull();
    expect(bulkReport(undefined)).toBeNull();
    expect(bulkReport('ok')).toBeNull();
    expect(bulkReport({})).toBeNull();
    expect(bulkReport({ requested: 1, succeeded: 1, ok: 'a', failed: [] })).toBeNull();
  });

  it('кривые строки отказа отбрасываются, без текста остаётся пустая строка', () => {
    expect(bulkReport({ requested: 2, succeeded: 0, ok: [1], failed: [null, { userId: 'x' }] })).toEqual({
      requested: 2,
      succeeded: 0,
      ok: [],
      failed: [{ userId: 'x', error: '' }],
    });
  });
});
