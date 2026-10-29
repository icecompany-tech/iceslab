import { describe, expect, it } from 'vitest';
import { PROFILE_CONFIG_KEYS, PROTOCOL_NAMES, type ProtocolName } from '@iceslab/shared';
import type { Profile } from '@/lib/domain/profiles';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig';

/**
 * A-285: a profile whose stored config holds every key the form looks after
 * (PROFILE_CONFIG_KEYS[protocol].form in shared, the list itself and not a
 * copy) goes through defaults() and the save's config builder, and comes back
 * with every one of those keys and its value. A key the form has no field for,
 * or a field defaults() does not seed, would be erased by the next save: the
 * server's PUT replaces the config whole.
 *
 * Some keys are sent only for the security or the network that uses them, so
 * xray is seeded twice (reality over xhttp, tls over grpc) and the keys are the
 * union of both saves; each save alone sends only listed keys.
 */
const SEEDED: Record<ProtocolName, Record<string, unknown>[]> = {
  hysteria: [
    {
      obfsPassword: 'obfs-secret',
      masqueradeUrl: 'https://www.bing.com',
      brutalUpMbps: 100,
      brutalDownMbps: 200,
      portHoppingStart: 20000,
      portHoppingEnd: 50000,
    },
  ],
  xray: [
    {
      security: 'reality',
      network: 'xhttp',
      subprotocol: 'vless',
      tlsServerName: 'tls.example.com',
      tlsCert: 'CERT',
      tlsKey: 'KEY',
      realityDest: 'www.microsoft.com:443',
      realityServerNames: ['www.microsoft.com'],
      realityShortIds: ['abcd'],
      realityPrivateKey: 'priv',
      realityPublicKey: 'pub',
      realityXver: 1,
      realityMaxTimeDiff: 60000,
      realityLimitFallbackUploadBytesPerSec: 1000,
      realityLimitFallbackDownloadBytesPerSec: 2000,
      realityMode: 'self-steal',
      realityFallbackUpstream: 'https://example.com',
      flow: 'xtls-rprx-vision',
      fingerprint: 'firefox',
      path: '/x',
      host: 'cdn.example.com',
      serviceName: 'svc',
      xhttpMode: 'packet-up',
      xhttpPaddingBytes: '100-1000',
    },
    {
      security: 'tls',
      network: 'grpc',
      subprotocol: 'vless',
      tlsServerName: 'tls.example.com',
      tlsCert: 'CERT',
      tlsKey: 'KEY',
      tlsRejectUnknownSni: true,
      realityDest: 'www.microsoft.com:443',
      realityServerNames: ['www.microsoft.com'],
      realityShortIds: ['abcd'],
      realityPrivateKey: 'priv',
      realityPublicKey: 'pub',
      realityMode: 'self-steal',
      realityFallbackUpstream: 'https://example.com',
      flow: '',
      fingerprint: 'firefox',
      serviceName: 'svc',
      grpcMultiMode: true,
    },
  ],
  amneziawg: [
    {
      subnet: '10.77.0.0/24',
      serverPrivateKey: 'priv',
      serverPublicKey: 'pub',
      obfuscation: {
        jc: 5, jmin: 50, jmax: 1000, s1: 20, s2: 30, s3: 0, s4: 0,
        h1: 1001, h2: 1002, h3: 1003, h4: 1004,
        i1: 'aa', i2: 'bb', i3: 'cc', i4: 'dd', i5: 'ee',
      },
    },
  ],
  naive: [{ hostname: 'naive.example.com', tlsEmail: 'ops@example.com', masqueradeRoot: '/srv/www' }],
  shadowsocks: [{ method: '2022-blake3-aes-128-gcm' }],
  mtproto: [{ domain: 'www.google.com' }],
  mieru: [{ mtu: 1300 }],
  tuic: [{ serverName: 'tuic.example.com', congestionControl: 'bbr' }],
  anytls: [{ serverName: 'anytls.example.com' }],
  shadowtls: [{ handshake: 'www.apple.com', ssMethod: '2022-blake3-chacha20-poly1305' }],
};

const profileOf = (protocol: ProtocolName, config: Record<string, unknown>) =>
  ({ id: 'p1', protocol, name: 'p', description: null, enabled: true, engine: null, config }) as unknown as Profile;

describe('profileConfigOf against PROFILE_CONFIG_KEYS.form (A-285)', () => {
  it('every protocol of the contract has a seeded profile here', () => {
    expect(Object.keys(SEEDED).sort()).toEqual([...PROTOCOL_NAMES].sort());
  });

  for (const protocol of PROTOCOL_NAMES) {
    it(`${protocol}: defaults() seeds every form key and the save sends it back unchanged`, () => {
      const form = [...PROFILE_CONFIG_KEYS[protocol].form].sort();
      const sent = new Set<string>();
      for (const stored of SEEDED[protocol]) {
        const config = profileConfigOf(defaults(profileOf(protocol, stored)));
        for (const key of Object.keys(config)) {
          expect(form, `${protocol}: ${key} is sent but not in the shared list`).toContain(key);
          sent.add(key);
          // Seeded from the stored value, not from a default of its own.
          if (key in stored) expect(config[key], `${protocol}.${key}`).toEqual(stored[key]);
        }
      }
      expect([...sent].sort()).toEqual(form);
    });
  }

  it('SOCKS5 and HTTP send only listed keys', () => {
    for (const subprotocol of ['socks', 'http']) {
      const config = profileConfigOf(defaults(profileOf('xray', { subprotocol, security: 'none', network: 'raw' })));
      for (const key of Object.keys(config)) expect(PROFILE_CONFIG_KEYS.xray.form).toContain(key);
    }
  });
});
