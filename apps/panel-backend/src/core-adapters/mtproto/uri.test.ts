import { describe, expect, it } from 'vitest';
import { buildMtprotoUri, buildMtprotoTmeUri, mtprotoSecret } from './uri.js';

describe('mtprotoSecret (single-secret-per-inbound model)', () => {
  it('produces ee + 16-byte (32 hex) secret + domain hex per FakeTLS spec', () => {
    const s = mtprotoSecret('inbound-uuid-1', 'www.cloudflare.com');
    expect(s.startsWith('ee')).toBe(true);
    // 2 ('ee') + 32 hex (16-byte secret) + 2*len(domain) hex
    expect(s).toHaveLength(2 + 32 + 'www.cloudflare.com'.length * 2);
    const domainHex = Buffer.from('www.cloudflare.com', 'utf8').toString('hex');
    expect(s.endsWith(domainHex)).toBe(true);
  });

  it('is deterministic for same (inboundId, domain)', () => {
    const a = mtprotoSecret('inbound-1', 'www.example.com');
    const b = mtprotoSecret('inbound-1', 'www.example.com');
    expect(a).toBe(b);
  });

  it('different inbound IDs yield different secrets', () => {
    const a = mtprotoSecret('inbound-1', 'www.cloudflare.com');
    const b = mtprotoSecret('inbound-2', 'www.cloudflare.com');
    expect(a).not.toBe(b);
  });

  it('domain change rotates the entire secret', () => {
    const a = mtprotoSecret('inbound-1', 'www.cloudflare.com');
    const b = mtprotoSecret('inbound-1', 'www.google.com');
    expect(a).not.toBe(b);
    // Both head and tail differ, head because the seed includes the
    // domain, tail because the domain is appended.
    // First 2 + 32 = 34 chars cover prefix + secret head.
    expect(a.slice(0, 34)).not.toBe(b.slice(0, 34));
  });
});

describe('buildMtprotoUri', () => {
  const opts = {
    secret: 'eeAA',
    host: 'proxy.example.com',
    port: 443,
    name: 'se-mtg-01',
  };

  it('emits tg://proxy?... form with all required params', () => {
    const uri = buildMtprotoUri(opts);
    expect(uri.startsWith('tg://proxy?')).toBe(true);
    expect(uri).toContain('server=proxy.example.com');
    expect(uri).toContain('port=443');
    expect(uri).toContain('secret=eeAA');
  });

  // Regression: 2026-05-20 - Telegram iOS rejects tg://proxy URIs that
  // carry a `#fragment` ("Некорректная ссылка на прокси"). Both forms
  // (tg:// and https://t.me/proxy) must stay fragment-free.
  it('emits no #fragment regardless of the name passed', () => {
    expect(buildMtprotoUri(opts)).not.toContain('#');
    expect(buildMtprotoUri({ ...opts, name: 'se mtg #1' })).not.toContain('#');
  });
});

describe('buildMtprotoTmeUri', () => {
  it('emits https://t.me/proxy?... with no fragment', () => {
    const uri = buildMtprotoTmeUri({
      secret: 'eeBB',
      host: 'proxy.example.com',
      port: 443,
    });
    expect(uri.startsWith('https://t.me/proxy?')).toBe(true);
    expect(uri).toContain('server=proxy.example.com');
    expect(uri).toContain('secret=eeBB');
    // t.me strips fragments, never emit one
    expect(uri).not.toContain('#');
  });
});
