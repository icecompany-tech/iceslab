import { describe, it, expect } from 'vitest';
import { buildAnytlsUri } from './uri.js';

describe('buildAnytlsUri', () => {
  it('builds an AnyTLS share link', () => {
    const uri = buildAnytlsUri({
      password: 'pw-1',
      host: '1.2.3.4',
      port: 8443,
      serverName: 'www.bing.com',
      name: 'DE',
    });
    expect(uri.startsWith('anytls://pw-1@1.2.3.4:8443?')).toBe(true);
    expect(uri).toContain('sni=www.bing.com');
    expect(uri).toContain('insecure=1');
    expect(uri.endsWith('#DE')).toBe(true);
  });

  it('omits the query string when there are no params', () => {
    const uri = buildAnytlsUri({ password: 'p', host: 'h', port: 443, allowInsecure: false });
    expect(uri).toBe('anytls://p@h:443');
  });
});
