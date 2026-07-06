import { describe, it, expect } from 'vitest';
import { buildVlessRealityUri } from './uri.js';

describe('buildVlessRealityUri', () => {
  const baseOpts = {
    uuid: '11111111-2222-3333-4444-555555555555',
    host: 'n1.example.com',
    port: 443,
    publicKey: 'pubkey-base64url',
    shortId: 'abc123',
    sni: 'www.cloudflare.com',
    name: 'eu-1',
  };

  it('emits a vless:// scheme with uuid@host:port', () => {
    const uri = buildVlessRealityUri(baseOpts);
    expect(uri).toMatch(/^vless:\/\/11111111-2222-3333-4444-555555555555@n1\.example\.com:443\?/);
  });

  it('includes the v24.9.30 raw network type (not the deprecated `tcp`)', () => {
    const uri = buildVlessRealityUri(baseOpts);
    expect(uri).toContain('type=raw');
    expect(uri).not.toContain('type=tcp');
  });

  it('includes REALITY-mandatory params', () => {
    const uri = buildVlessRealityUri(baseOpts);
    expect(uri).toContain('security=reality');
    expect(uri).toContain('encryption=none');
    expect(uri).toContain('pbk=pubkey-base64url');
    expect(uri).toContain('sid=abc123');
    expect(uri).toContain('sni=www.cloudflare.com');
  });

  it('defaults flow to xtls-rprx-vision and fingerprint to chrome', () => {
    const uri = buildVlessRealityUri(baseOpts);
    expect(uri).toContain('flow=xtls-rprx-vision');
    expect(uri).toContain('fp=chrome');
  });

  it('honours explicit flow / fingerprint overrides', () => {
    const uri = buildVlessRealityUri({
      ...baseOpts,
      flow: 'xtls-rprx-vision-udp443',
      fingerprint: 'firefox',
    });
    expect(uri).toContain('flow=xtls-rprx-vision-udp443');
    expect(uri).toContain('fp=firefox');
  });

  it('URL-encodes the name fragment', () => {
    const uri = buildVlessRealityUri({ ...baseOpts, name: 'eu node #1' });
    expect(uri).toMatch(/#eu%20node%20%231$/);
  });

  it('URL-encodes special chars in sni param via URLSearchParams', () => {
    const uri = buildVlessRealityUri({ ...baseOpts, sni: 'a&b' });
    expect(uri).toContain('sni=a%26b');
  });

  it('emits network=ws + path + host header when network=ws', () => {
    const uri = buildVlessRealityUri({
      ...baseOpts,
      network: 'ws',
      path: '/api',
      hostHeader: 'cdn.example.com',
    });
    expect(uri).toContain('type=ws');
    expect(uri).toContain('path=%2Fapi');
    expect(uri).toContain('host=cdn.example.com');
    // Vision is incompatible with ws, must not be emitted.
    expect(uri).not.toContain('flow=');
  });

  it('emits serviceName when network=grpc', () => {
    const uri = buildVlessRealityUri({
      ...baseOpts,
      network: 'grpc',
      serviceName: 'GunService',
    });
    expect(uri).toContain('type=grpc');
    expect(uri).toContain('serviceName=GunService');
    expect(uri).not.toContain('flow=');
  });

  it('keeps flow on network=xhttp (Vision-compatible)', () => {
    const uri = buildVlessRealityUri({ ...baseOpts, network: 'xhttp' });
    expect(uri).toContain('type=xhttp');
    expect(uri).toContain('flow=xtls-rprx-vision');
  });

  // ───── slice 24c part 2: httpupgrade + kcp transports ─────

  it('emits path/host on network=httpupgrade and drops Vision flow', () => {
    const uri = buildVlessRealityUri({
      ...baseOpts,
      network: 'httpupgrade',
      path: '/u',
      hostHeader: 'cdn.example.com',
    });
    expect(uri).toContain('type=httpupgrade');
    expect(uri).toContain('path=%2Fu');
    expect(uri).toContain('host=cdn.example.com');
    expect(uri).not.toContain('flow=');
  });

  it('emits headerType on network=kcp and drops Vision flow', () => {
    const uri = buildVlessRealityUri({ ...baseOpts, network: 'kcp' });
    expect(uri).toContain('type=kcp');
    expect(uri).toContain('headerType=none');
    expect(uri).not.toContain('flow=');
  });
});
