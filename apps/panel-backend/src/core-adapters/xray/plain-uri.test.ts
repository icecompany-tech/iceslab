import { describe, it, expect } from 'vitest';
import { buildHttpProxyUri, buildSocksUri, buildTelegramSocksUri } from './plain-uri.js';

const opts = { host: 'de-1.example.com', port: 1080, username: 'alice', password: '11111111-1111-4111-8111-111111111111' };

describe('share links for the Telegram doors', () => {
  it('socks:// carries user:pass base64-encoded in the userinfo', () => {
    const uri = buildSocksUri({ ...opts, name: 'DE · SOCKS5' });
    expect(uri).toBe(
      `socks://${Buffer.from(`alice:${opts.password}`).toString('base64')}@de-1.example.com:1080#DE%20%C2%B7%20SOCKS5`,
    );
  });

  it('http:// percent-encodes both halves', () => {
    const uri = buildHttpProxyUri({ ...opts, port: 3128, username: 'a@b', name: 'x' });
    expect(uri).toBe(`http://a%40b:${opts.password}@de-1.example.com:3128#x`);
  });

  it('tg://socks carries server, port, user and pass, and no fragment', () => {
    // Telegram answers a fragment on its proxy links with "Invalid proxy link"
    // (the MTProto finding of 2026-05-20).
    const uri = buildTelegramSocksUri(opts);
    expect(uri).toBe(`tg://socks?server=de-1.example.com&port=1080&user=alice&pass=${opts.password}`);
    expect(uri).not.toContain('#');
  });
});
