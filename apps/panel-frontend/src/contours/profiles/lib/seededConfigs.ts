import type { ProtocolName } from '@iceslab/shared';

/**
 * A stored config per protocol that holds every key the profile form looks
 * after (PROFILE_CONFIG_KEYS[protocol].form). xray is seeded twice, because
 * some of its keys belong to one security or network only: reality over
 * xhttp, tls over grpc. Shared by the tests that hold the form's save
 * (profileConfig.test.ts, A-285) and the card's facts (profileFacts.test.ts,
 * A-287) to the shared list.
 */
export const SEEDED: Record<ProtocolName, Record<string, unknown>[]> = {
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
