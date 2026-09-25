import { describe, expect, it } from 'vitest';
import { buildSurgeConf } from './surge.js';
import { buildQuantumultXConf } from './quantumultx.js';
import { buildLoonConf } from './loon.js';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

const ss: SubscriptionEndpoint = {
  protocol: 'shadowsocks',
  nodeName: 'eu-1',
  host: 'n.example.com',
  port: 8388,
  method: '2022-blake3-aes-128-gcm',
  password: 'ss-pass',
  uri: '',
};
const hy: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'eu-2',
  host: 'n2.example.com',
  port: 443,
  password: 'hy-pass',
  obfsPassword: 'salt',
  downMbps: 100,
  uri: '',
};
const vlessReality: SubscriptionEndpoint = {
  protocol: 'xray',
  nodeName: 'eu-3',
  host: 'n3.example.com',
  port: 443,
  uuid: 'uuid-1',
  publicKey: 'PUBKEY',
  shortId: 'SHORT',
  sni: 'www.cloudflare.com',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
  network: 'raw',
  subprotocol: 'vless',
  securityLayer: 'default',
  uri: '',
};
const trojanTls: SubscriptionEndpoint = {
  ...vlessReality,
  nodeName: 'eu-4',
  subprotocol: 'trojan',
  securityLayer: 'tls',
};

describe('buildSurgeConf (ss/vmess/trojan/hy2, no vless/REALITY)', () => {
  it('emits ss + hysteria2 lines', () => {
    const out = buildSurgeConf([ss, hy]);
    expect(out).toContain('eu-1 = ss, n.example.com, 8388, encrypt-method=2022-blake3-aes-128-gcm, password=ss-pass');
    expect(out).toContain('eu-2 = hysteria2, n2.example.com, 443, password=hy-pass');
    expect(out).toContain('download-bandwidth=100');
    expect(out).toContain('salamander-password=salt');
  });
  it('skips REALITY xray (Surge cannot do reality/vless)', () => {
    expect(buildSurgeConf([vlessReality])).toBe('');
  });
  it('emits a trojan line over real TLS', () => {
    expect(buildSurgeConf([trojanTls])).toContain(
      'eu-4 = trojan, n3.example.com, 443, password=uuid-1, sni=www.cloudflare.com',
    );
  });
});

describe('buildQuantumultXConf (incl REALITY, verified syntax)', () => {
  it('emits a vless REALITY line with the verified reality params', () => {
    const out = buildQuantumultXConf([vlessReality]);
    expect(out).toContain('vless=n3.example.com:443');
    expect(out).toContain('password=uuid-1');
    expect(out).toContain('obfs=over-tls');
    expect(out).toContain('obfs-host=www.cloudflare.com');
    expect(out).toContain('reality-base64-pubkey=PUBKEY');
    expect(out).toContain('reality-hex-shortid=SHORT');
    expect(out).toContain('vless-flow=xtls-rprx-vision');
    expect(out).toContain('tag=eu-3');
  });
  it('emits a shadowsocks line', () => {
    expect(buildQuantumultXConf([ss])).toContain(
      'shadowsocks=n.example.com:8388, method=2022-blake3-aes-128-gcm, password=ss-pass',
    );
  });
  it('skips hysteria (QX unsupported)', () => {
    expect(buildQuantumultXConf([hy])).toBe('');
  });
});

// The lines against nsloon.app/en/docs/Node (read 2026-09-25): key=value, `sni`,
// capitalised type names. No `key:value` survives anywhere in the output.
describe('buildLoonConf (the grammar of the Loon docs)', () => {
  it('emits a VLESS REALITY line', () => {
    expect(buildLoonConf([vlessReality])).toBe(
      'eu-3 = VLESS,n3.example.com,443,"uuid-1",transport=tcp,flow=xtls-rprx-vision,public-key="PUBKEY",short-id=SHORT,over-tls=true,sni=www.cloudflare.com\n',
    );
  });
  it('emits a Hysteria2 line with Salamander, bandwidth and port hopping', () => {
    expect(buildLoonConf([{ ...hy, portHoppingStart: 20000, portHoppingEnd: 50000 }])).toBe(
      'eu-2 = Hysteria2,n2.example.com,443,"hy-pass",salamander-password=salt,server-ports="20000:50000",download-bandwidth=100\n',
    );
  });
  it('emits a Trojan line over TLS', () => {
    expect(buildLoonConf([trojanTls])).toBe('eu-4 = Trojan,n3.example.com,443,"uuid-1",sni=www.cloudflare.com\n');
  });
  it('emits a Shadowsocks line', () => {
    expect(buildLoonConf([ss])).toBe('eu-1 = Shadowsocks,n.example.com,8388,2022-blake3-aes-128-gcm,"ss-pass",udp=true\n');
  });
  it('writes no key:value parameter at all', () => {
    const out = buildLoonConf([ss, hy, vlessReality, trojanTls]);
    for (const line of out.trim().split('\n')) {
      for (const p of line.split(' = ')[1]!.split(',')) expect(p, line).not.toMatch(/^[a-z-]+:/);
    }
  });
});
