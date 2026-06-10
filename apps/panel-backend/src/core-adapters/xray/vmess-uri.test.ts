import { describe, expect, it } from 'vitest';
import { buildVmessUri } from './vmess-uri.js';

function decode(uri: string): Record<string, string> {
  expect(uri.startsWith('vmess://')).toBe(true);
  const json = Buffer.from(uri.slice('vmess://'.length), 'base64').toString('utf-8');
  return JSON.parse(json);
}

const base = {
  uuid: '11111111-1111-1111-1111-111111111111',
  host: 'cdn.example.com',
  port: 443,
  name: 'eu node #1',
};

describe('buildVmessUri', () => {
  it('encodes a base64 JSON link with the core vmess fields', () => {
    const o = decode(buildVmessUri(base));
    expect(o.v).toBe('2');
    expect(o.add).toBe('cdn.example.com');
    expect(o.port).toBe('443'); // string, per the v2rayN spec
    expect(o.id).toBe(base.uuid);
    expect(o.aid).toBe('0'); // AEAD
    expect(o.scy).toBe('auto');
    expect(o.ps).toBe('eu node #1');
  });

  it('maps raw network to "tcp"', () => {
    expect(decode(buildVmessUri({ ...base, network: 'raw' })).net).toBe('tcp');
  });

  it('ws carries path + host header, tls empty for security none', () => {
    const o = decode(
      buildVmessUri({
        ...base,
        network: 'ws',
        path: '/stream',
        hostHeader: 'front.example.com',
        securityLayer: 'none',
      }),
    );
    expect(o.net).toBe('ws');
    expect(o.path).toBe('/stream');
    expect(o.host).toBe('front.example.com');
    expect(o.tls).toBe('');
  });

  it('grpc serviceName lands in the path field', () => {
    const o = decode(buildVmessUri({ ...base, network: 'grpc', serviceName: 'GunService' }));
    expect(o.net).toBe('grpc');
    expect(o.path).toBe('GunService');
  });

  it('tls layer adds sni + fingerprint', () => {
    const o = decode(
      buildVmessUri({
        ...base,
        network: 'ws',
        securityLayer: 'tls',
        sni: 'cdn.example.com',
        fingerprint: 'chrome',
      }),
    );
    expect(o.tls).toBe('tls');
    expect(o.sni).toBe('cdn.example.com');
    expect(o.fp).toBe('chrome');
  });

  it('never emits REALITY fields (the format cannot carry them)', () => {
    const o = decode(buildVmessUri({ ...base, securityLayer: 'none' }));
    expect(o.pbk).toBeUndefined();
    expect(o.sid).toBeUndefined();
  });
});
