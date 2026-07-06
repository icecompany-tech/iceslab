import { describe, expect, it } from 'vitest';
import { buildShadowsocksUri } from './uri.js';

const baseOpts = {
  method: '2022-blake3-aes-256-gcm' as const,
  userPsk: 'cabc78ae-94e3-4a16-936a-133d059acfac',
  serverPsk: 'BASE64-SERVER-PSK',
  host: 'ss.example.com',
  port: 8388,
  name: 'se-ss-01',
};

function decodeUserinfo(uri: string): string {
  const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
  const base64 = userinfo.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

describe('buildShadowsocksUri', () => {
  it('uses ss:// scheme with base64url-encoded userinfo', () => {
    const uri = buildShadowsocksUri(baseOpts);
    expect(uri.startsWith('ss://')).toBe(true);
    expect(uri).toContain('@ss.example.com:8388');
  });

  it('SS2022 multi-user: encodes method:ServerPSK:UserPSK colon-joined', () => {
    const decoded = decodeUserinfo(buildShadowsocksUri(baseOpts));
    expect(decoded).toBe(`${baseOpts.method}:${baseOpts.serverPsk}:${baseOpts.userPsk}`);
  });

  it('single-tenant (no serverPsk): encodes method:UserPSK only', () => {
    const decoded = decodeUserinfo(buildShadowsocksUri({
      ...baseOpts,
      serverPsk: undefined,
    }));
    expect(decoded).toBe(`${baseOpts.method}:${baseOpts.userPsk}`);
    expect(decoded).not.toContain(`:${baseOpts.userPsk}:`); // no triple colon
  });

  it('emits no padding (=) in userinfo', () => {
    const userinfo = buildShadowsocksUri(baseOpts).slice(
      'ss://'.length,
      buildShadowsocksUri(baseOpts).indexOf('@'),
    );
    expect(userinfo).not.toContain('=');
  });

  it('uses base64url alphabet (no + or /)', () => {
    // Force a payload whose standard-base64 contains + or /
    const uri = buildShadowsocksUri({
      ...baseOpts,
      userPsk: '\xff\xff\xff',
    });
    const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
    expect(userinfo).not.toMatch(/[+/]/);
  });

  it('appends fragment from name', () => {
    expect(buildShadowsocksUri(baseOpts).endsWith('#se-ss-01')).toBe(true);
  });

  it('encodes name fragment for URI safety', () => {
    const uri = buildShadowsocksUri({ ...baseOpts, name: 'node 1 / RU' });
    expect(uri).toContain('#node%201%20%2F%20RU');
  });

  it('supports legacy AEAD ciphers (single-tenant, no server PSK)', () => {
    // Legacy AEAD doesn't have a server-PSK concept; pass undefined.
    const decoded = decodeUserinfo(buildShadowsocksUri({
      ...baseOpts,
      method: 'chacha20-ietf-poly1305',
      serverPsk: undefined,
    }));
    expect(decoded.startsWith('chacha20-ietf-poly1305:')).toBe(true);
    // After the cipher prefix, just the user PSK, no extra colons.
    expect(decoded).toBe(`chacha20-ietf-poly1305:${baseOpts.userPsk}`);
  });
});
