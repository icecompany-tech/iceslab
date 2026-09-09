import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// K8 - TOTP (RFC 6238 / HOTP RFC 4226) for admin 2FA. Self-contained (no
// dependency) so the panel doesn't pull an extra package; verified against the
// RFC 6238 SHA1 test vectors in totp.test.ts.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 (no padding) - the encoding authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a fresh 160-bit base32 TOTP secret. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for QR enrollment in authenticator apps. */
export function totpUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The 6-digit TOTP for the given secret at `timeSec` (Unix seconds). */
export function generateTotp(secretBase32: string, timeSec: number): string {
  return hotp(base32Decode(secretBase32), Math.floor(timeSec / PERIOD_SECONDS));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a 6-digit code and return the matched absolute time-step (counter),
 * or null if no step within +/-`window` (default +/-1 = +/-30s) matches.
 * Constant-time compare to avoid leaking the code. The returned step is what
 * lets a caller defeat replay: store the last accepted step and reject any
 * code whose step is <= it (RFC 6238 section 5.2).
 */
export function verifyTotpStep(
  secretBase32: string,
  code: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  window = 1,
): number | null {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(nowSec / PERIOD_SECONDS);
  for (let w = -window; w <= window; w++) {
    if (safeEqual(hotp(key, counter + w), normalized)) return counter + w;
  }
  return null;
}

/**
 * Boolean form of verifyTotpStep, for callers that don't track replay (2FA
 * enable/disable, which already require an authenticated session).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  window = 1,
): boolean {
  return verifyTotpStep(secretBase32, code, nowSec, window) !== null;
}
