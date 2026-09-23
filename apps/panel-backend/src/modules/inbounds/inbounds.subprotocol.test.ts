import { describe, it, expect } from 'vitest';
import { XRAY_SUBPROTOCOLS } from '@iceslab/shared';
import { XrayConfigSchema } from './inbounds.schemas.js';

/**
 * socks and http, the Telegram entries (2026-09-23): the contract.
 *
 * Telegram's clients dial plain SOCKS5 and HTTP CONNECT over TCP. A profile
 * saved with REALITY or a transport would be a door no client can open, and it
 * would look fine on the screen, so the schema refuses it.
 */
describe('the socks and http subprotocols', () => {
  for (const sub of ['socks', 'http'] as const) {
    it(`takes ${sub} with security none over raw`, () => {
      const r = XrayConfigSchema.safeParse({ subprotocol: sub, security: 'none', network: 'raw' });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });

    it(`refuses ${sub} with REALITY, which is also the default security`, () => {
      const r = XrayConfigSchema.safeParse({ subprotocol: sub });
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('security');
    });

    it(`refuses ${sub} over a transport`, () => {
      const r = XrayConfigSchema.safeParse({ subprotocol: sub, security: 'none', network: 'ws' });
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('network');
    });
  }

  it('leaves vless, trojan and vmess exactly as they were', () => {
    expect(XrayConfigSchema.safeParse({}).success).toBe(true);
    expect(XrayConfigSchema.safeParse({ subprotocol: 'vmess', security: 'none', network: 'ws' }).success).toBe(true);
  });

  it('reads its dictionary from shared', () => {
    for (const sub of XRAY_SUBPROTOCOLS) {
      const r = XrayConfigSchema.safeParse({ subprotocol: sub, security: 'none', network: 'raw' });
      expect(r.success, sub).toBe(true);
    }
    expect(XrayConfigSchema.safeParse({ subprotocol: 'mtproto', security: 'none' }).success).toBe(false);
  });

  it('stores a socks or http config as exactly three keys, whatever came with it', () => {
    // The vless defaults (flow, fingerprint, realityMode...) used to fill it,
    // land in the database, and make the screen draw "Xray REALITY".
    for (const sub of ['socks', 'http'] as const) {
      const r = XrayConfigSchema.parse({
        subprotocol: sub,
        security: 'none',
        network: 'raw',
        flow: 'xtls-rprx-vision',
        realityServerNames: ['www.example.com'],
        udp: true,
      });
      expect(r).toEqual({ subprotocol: sub, security: 'none', network: 'raw' });
    }
  });
});
