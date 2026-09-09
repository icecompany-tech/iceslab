import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotp,
  totpUri,
  verifyTotp,
  verifyTotpStep,
} from './totp.js';

// RFC 6238 Appendix B test vectors (SHA1, secret = ASCII "12345678901234567890").
// The RFC lists 8-digit values; we emit 6 digits = the last 6 of each.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('base32 round-trips', () => {
    const b = Buffer.from('12345678901234567890');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it('matches RFC 6238 SHA1 6-digit vectors', () => {
    expect(generateTotp(RFC_SECRET, 59)).toBe('287082');
    expect(generateTotp(RFC_SECRET, 1111111109)).toBe('081804');
    expect(generateTotp(RFC_SECRET, 1234567890)).toBe('005924');
    expect(generateTotp(RFC_SECRET, 2000000000)).toBe('279037');
  });

  it('verifyTotp accepts current code, rejects wrong', () => {
    const now = 1234567890;
    expect(verifyTotp(RFC_SECRET, '005924', now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, '000000', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abc', now)).toBe(false);
  });

  it('verifyTotp tolerates +/-1 step of skew but not more', () => {
    const now = 1234567890;
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 30), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now + 30), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 120), now)).toBe(false);
  });

  it('verifyTotpStep returns the matched step (for replay rejection)', () => {
    const now = 1234567890;
    const step = Math.floor(now / 30);
    // current code resolves to the current step
    expect(verifyTotpStep(RFC_SECRET, '005924', now)).toBe(step);
    // bad / malformed codes resolve to null
    expect(verifyTotpStep(RFC_SECRET, '000000', now)).toBeNull();
    expect(verifyTotpStep(RFC_SECRET, 'abc', now)).toBeNull();
    // a previous-window code resolves to the previous step, so a caller that
    // stored `step` as the last-accepted one would reject it as a replay.
    expect(verifyTotpStep(RFC_SECRET, generateTotp(RFC_SECRET, now - 30), now)).toBe(step - 1);
  });

  it('totpUri is a well-formed otpauth URL', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'admin', 'Iceslab');
    expect(uri.startsWith('otpauth://totp/Iceslab%3Aadmin?')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Iceslab');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
