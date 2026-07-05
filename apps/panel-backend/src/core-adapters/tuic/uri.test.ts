import { describe, it, expect } from 'vitest';
import { buildTuicUri } from './uri.js';

describe('buildTuicUri', () => {
  it('builds a TUIC v5 share link', () => {
    const uri = buildTuicUri({
      uuid: 'uuid-1',
      password: 'pw-1',
      host: '1.2.3.4',
      port: 8443,
      serverName: 'www.bing.com',
      congestionControl: 'bbr',
      name: 'DE',
    });
    expect(uri.startsWith('tuic://uuid-1:pw-1@1.2.3.4:8443?')).toBe(true);
    expect(uri).toContain('sni=www.bing.com');
    expect(uri).toContain('congestion_control=bbr');
    expect(uri).toContain('alpn=h3');
    expect(uri).toContain('udp_relay_mode=native');
    expect(uri).toContain('allow_insecure=1');
    expect(uri.endsWith('#DE')).toBe(true);
  });

  it('defaults congestion to bbr and omits sni when absent', () => {
    const uri = buildTuicUri({ uuid: 'u', password: 'p', host: 'h', port: 443 });
    expect(uri).toContain('congestion_control=bbr');
    expect(uri).not.toContain('sni=');
  });

  it('can disable allow_insecure', () => {
    const uri = buildTuicUri({ uuid: 'u', password: 'p', host: 'h', port: 443, allowInsecure: false });
    expect(uri).not.toContain('allow_insecure');
  });
});
