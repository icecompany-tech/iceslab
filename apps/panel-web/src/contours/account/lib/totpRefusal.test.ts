import { describe, expect, it } from 'vitest';
import { isTotpRefusal } from '@/contours/account/lib/totpRefusal';

const http = (status: number, data: unknown) => ({ response: { status, data } });

describe('isTotpRefusal', () => {
  it('reads nothing from an input that is not an http error', () => {
    for (const err of [null, undefined, 'boom', 42, {}, { response: null }, { response: 'x' }, new Error('net')]) {
      expect(isTotpRefusal(err)).toBe(false);
    }
  });

  it('is a wrong code on 400 INVALID_TOTP', () => {
    expect(isTotpRefusal(http(400, { error: 'INVALID_TOTP', message: 'Invalid 2FA code' }))).toBe(true);
    expect(isTotpRefusal(http(400, { error: 'INVALID_TOTP' }))).toBe(true);
  });

  it('leaves other refusals to the toast', () => {
    expect(isTotpRefusal(http(409, { error: 'CONFLICT', message: '2FA is already enabled' }))).toBe(false);
    expect(isTotpRefusal(http(400, { error: 'VALIDATION_ERROR' }))).toBe(false);
    expect(isTotpRefusal(http(400, null))).toBe(false);
    expect(isTotpRefusal(http(500, { error: 'INVALID_TOTP' }))).toBe(false);
  });

  it('does not take the login 401 for a field error: the session interceptor owns 401', () => {
    expect(isTotpRefusal(http(401, { error: 'INVALID_TOTP', requires2fa: true }))).toBe(false);
  });
});
