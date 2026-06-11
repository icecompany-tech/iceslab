import { describe, expect, it } from 'vitest';
import { parseRealityDestTarget } from './test-connect.service.js';

describe('parseRealityDestTarget (K10)', () => {
  it('splits host:port and uses serverNames[0] as the SNI', () => {
    expect(
      parseRealityDestTarget('avatars.mds.yandex.net:443', ['avatars.mds.yandex.net']),
    ).toEqual({ host: 'avatars.mds.yandex.net', port: 443, sni: 'avatars.mds.yandex.net' });
  });

  it('defaults port to 443 when absent', () => {
    expect(parseRealityDestTarget('www.samsung.com', ['www.samsung.com'])).toEqual({
      host: 'www.samsung.com',
      port: 443,
      sni: 'www.samsung.com',
    });
  });

  it('honours a non-443 dest port', () => {
    expect(parseRealityDestTarget('127.0.0.1:8443', ['icecompany.tech'])).toEqual({
      host: '127.0.0.1',
      port: 8443,
      sni: 'icecompany.tech',
    });
  });

  it('falls back to the dest host as SNI when serverNames is empty', () => {
    expect(parseRealityDestTarget('dl.google.com:443', [])).toEqual({
      host: 'dl.google.com',
      port: 443,
      sni: 'dl.google.com',
    });
    expect(parseRealityDestTarget('dl.google.com:443', undefined)).toEqual({
      host: 'dl.google.com',
      port: 443,
      sni: 'dl.google.com',
    });
  });

  it('treats a non-numeric port as 443 (defensive)', () => {
    expect(parseRealityDestTarget('host.example:abc', ['host.example']).port).toBe(443);
  });

  it('returns null for an empty dest', () => {
    expect(parseRealityDestTarget('', ['x'])).toBeNull();
  });
});
