import { describe, expect, it } from 'vitest';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';
import {
  PASSWORD_PROBLEM_KEY,
  passwordBody,
  passwordFormProblems,
  passwordRefusal,
} from '@/contours/settings/lib/passwordChange';

const ok = { current: 'old-pass-1', next: 'new-pass-1', repeat: 'new-pass-1', totp: '' };
const res = (status: number, data: unknown) => ({ response: { status, data } });
const at = (d: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d);

describe('форма смены пароля (A-039)', () => {
  it('верная форма без 2FA: ничего; тело без кода', () => {
    expect(passwordFormProblems(ok, false)).toEqual({});
    expect(passwordBody(ok, false)).toEqual({ currentPassword: 'old-pass-1', newPassword: 'new-pass-1' });
  });

  it('по правилу регистрации и до запроса: пусто, коротко, длинно, тот же, повтор', () => {
    expect(passwordFormProblems({ ...ok, current: '' }, false)).toEqual({ current: 'required' });
    expect(passwordFormProblems({ ...ok, next: 'short', repeat: 'short' }, false)).toEqual({ next: 'short' });
    expect(passwordFormProblems({ ...ok, next: 'x'.repeat(129), repeat: 'x'.repeat(129) }, false)).toEqual({ next: 'long' });
    expect(passwordFormProblems({ ...ok, next: 'old-pass-1', repeat: 'old-pass-1' }, false)).toEqual({ next: 'same' });
    expect(passwordFormProblems({ ...ok, repeat: 'other-pass' }, false)).toEqual({ repeat: 'mismatch' });
  });

  it('2FA включена: код 6 цифр обязателен и уходит в теле', () => {
    expect(passwordFormProblems(ok, true)).toEqual({ totp: 'totpFormat' });
    expect(passwordFormProblems({ ...ok, totp: '12345' }, true)).toEqual({ totp: 'totpFormat' });
    expect(passwordFormProblems({ ...ok, totp: '123456' }, true)).toEqual({});
    expect(passwordBody({ ...ok, totp: '123456' }, true)).toEqual({
      currentPassword: 'old-pass-1',
      newPassword: 'new-pass-1',
      totpCode: '123456',
    });
  });
});

describe('отказы сервера у своего поля', () => {
  it('по контракту BACK', () => {
    expect(passwordRefusal(res(403, { error: 'INVALID_CURRENT_PASSWORD' }))).toEqual({ field: 'current', problem: 'wrongCurrent' });
    expect(passwordRefusal(res(400, { error: 'PASSWORD_UNCHANGED' }))).toEqual({ field: 'next', problem: 'same' });
    expect(passwordRefusal(res(400, { error: 'VALIDATION_ERROR', issues: [] }))).toEqual({ field: 'next', problem: 'weak' });
    expect(passwordRefusal(res(403, { error: 'TOTP_REQUIRED', requires2fa: true }))).toEqual({ field: 'totp', problem: 'totpRequired' });
    expect(passwordRefusal(res(403, { error: 'INVALID_TOTP' }))).toEqual({ field: 'totp', problem: 'totpWrong' });
    expect(passwordRefusal(res(429, { error: 'ACCOUNT_LOCKED', retryAfterSeconds: 600 }))).toEqual({
      field: 'form',
      problem: 'locked',
      retryAfterSeconds: 600,
    });
    expect(passwordRefusal(res(429, { error: 'ACCOUNT_LOCKED' }))).toEqual({ field: 'form', problem: 'locked' });
  });

  it('не эти: другой статус или код, кривой вход', () => {
    expect(passwordRefusal(res(401, { error: 'INVALID_CURRENT_PASSWORD' }))).toBeNull();
    expect(passwordRefusal(res(403, { error: 'FORBIDDEN' }))).toBeNull();
    for (const e of [null, undefined, 'x', {}, { response: null }, res(403, null)]) expect(passwordRefusal(e)).toBeNull();
  });

  it('каждая проблема названа в ru и en', () => {
    for (const key of Object.values(PASSWORD_PROBLEM_KEY)) {
      expect(typeof at(ru, key), `ru ${key}`).toBe('string');
      expect(typeof at(en, key), `en ${key}`).toBe('string');
    }
  });
});
