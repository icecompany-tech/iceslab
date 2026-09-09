import { describe, it, expect } from 'vitest';
import { generateUserCredentials } from './credentials.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
// 32 raw bytes encoded as standard base64 → 44 chars including the trailing '='
const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

describe('generateUserCredentials', () => {
  it('produces a valid UUID for xrayUuid', () => {
    const creds = generateUserCredentials();
    expect(creds.xrayUuid).toMatch(UUID_RE);
  });

  it('produces 32-byte WireGuard keys for AmneziaWG', () => {
    const creds = generateUserCredentials();
    expect(creds.amneziawgPrivateKey).toMatch(WG_KEY_RE);
    expect(creds.amneziawgPublicKey).toMatch(WG_KEY_RE);
    expect(creds.amneziawgPrivateKey).not.toEqual(creds.amneziawgPublicKey);
  });

  it('produces base64url-encoded passwords for Hysteria and Naive', () => {
    const creds = generateUserCredentials();
    expect(creds.hysteriaPassword).toMatch(BASE64URL_RE);
    expect(creds.naivePassword).toMatch(BASE64URL_RE);
    expect(creds.hysteriaPassword.length).toBeGreaterThanOrEqual(32);
    expect(creds.naivePassword.length).toBeGreaterThanOrEqual(32);
  });

  it('produces a base64url subscription token of usable length', () => {
    const creds = generateUserCredentials();
    expect(creds.subscriptionToken).toMatch(BASE64URL_RE);
    expect(creds.subscriptionToken.length).toBeGreaterThanOrEqual(40);
  });

  it('produces a hex shortId within the REALITY 16-char limit', () => {
    const creds = generateUserCredentials();
    // REALITY shortIds must be hex (the inbound schema enforces ^[0-9a-fA-F]{0,16}$).
    expect(creds.shortId).toMatch(/^[0-9a-f]+$/);
    expect(creds.shortId.length).toBeLessThanOrEqual(16);
  });

  it('produces unique credentials on each call', () => {
    const a = generateUserCredentials();
    const b = generateUserCredentials();
    expect(a.xrayUuid).not.toEqual(b.xrayUuid);
    expect(a.hysteriaPassword).not.toEqual(b.hysteriaPassword);
    expect(a.amneziawgPrivateKey).not.toEqual(b.amneziawgPrivateKey);
    expect(a.subscriptionToken).not.toEqual(b.subscriptionToken);
    expect(a.shortId).not.toEqual(b.shortId);
  });
});
