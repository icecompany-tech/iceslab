import { describe, expect, it } from 'vitest';
import { XRAY_PLAIN_SUBPROTOCOLS, XRAY_SUBPROTOCOLS } from '@iceslab/shared';
import {
  engineRefused,
  isPlainSubprotocol,
  plainDefaultPort,
  plainSubprotocolOf,
  plainXrayConfig,
} from '@/contours/profiles/lib/plainSubprotocol';

describe('isPlainSubprotocol', () => {
  it('says yes exactly for the contract list, whatever it holds', () => {
    for (const s of XRAY_SUBPROTOCOLS) {
      expect(isPlainSubprotocol(s)).toBe((XRAY_PLAIN_SUBPROTOCOLS as readonly string[]).includes(s));
    }
    expect(isPlainSubprotocol(undefined)).toBe(false);
    expect(isPlainSubprotocol('')).toBe(false);
  });
});

describe('plainXrayConfig', () => {
  it('sends the subprotocol with security none and network raw, and nothing else', () => {
    expect(plainXrayConfig('socks')).toEqual({ subprotocol: 'socks', security: 'none', network: 'raw' });
    expect(plainXrayConfig('http')).toEqual({ subprotocol: 'http', security: 'none', network: 'raw' });
  });
});

describe('engineRefused', () => {
  it('a missing or odd error is not this refusal', () => {
    for (const e of [null, undefined, 'boom', new Error('x'), {}, { response: null }, { response: { status: 400 } }]) {
      expect(engineRefused(e)).toBe(false);
    }
  });

  it('the server answer for socks on sing-box, as dev returned it 23.09', () => {
    const err = {
      response: {
        status: 400,
        data: {
          error: 'VALIDATION_ERROR',
          message: 'Invalid input',
          issues: [{ code: 'custom', message: 'socks and http are served by the xray engine only', path: ['engine'] }],
        },
      },
    };
    expect(engineRefused(err)).toBe(true);
  });

  it('a 400 about another field, or another status, is not about the engine', () => {
    const issue = (path: unknown[]) => ({ code: 'custom', message: 'x', path });
    expect(engineRefused({ response: { status: 400, data: { issues: [issue(['config', 'security'])] } } })).toBe(false);
    expect(engineRefused({ response: { status: 409, data: { issues: [issue(['engine'])] } } })).toBe(false);
    expect(engineRefused({ response: { status: 400, data: { issues: [null, 'x'] } } })).toBe(false);
  });
});

describe('plainSubprotocolOf', () => {
  it('names socks and http on xray, and nothing else', () => {
    expect(plainSubprotocolOf({ protocol: 'xray', config: { subprotocol: 'socks', flow: 'xtls-rprx-vision' } })).toBe('socks');
    expect(plainSubprotocolOf({ protocol: 'xray', config: { subprotocol: 'http' } })).toBe('http');
    expect(plainSubprotocolOf({ protocol: 'xray', config: { subprotocol: 'vless' } })).toBeNull();
    expect(plainSubprotocolOf({ protocol: 'mtproto', config: { subprotocol: 'socks' } })).toBeNull();
    expect(plainSubprotocolOf(null)).toBeNull();
  });
});

describe('plainDefaultPort', () => {
  it('1080 for socks and 3128 for http, never 8080', () => {
    expect(plainDefaultPort({ protocol: 'xray', config: { subprotocol: 'socks' } })).toBe(1080);
    expect(plainDefaultPort({ protocol: 'xray', config: { subprotocol: 'http' } })).toBe(3128);
  });

  it('has no opinion about anything else, so the free-port suggestion stays', () => {
    expect(plainDefaultPort({ protocol: 'xray', config: { subprotocol: 'vless' } })).toBeNull();
    expect(plainDefaultPort({ protocol: 'xray', config: {} })).toBeNull();
    expect(plainDefaultPort({ protocol: 'xray', config: null })).toBeNull();
    // A socks key on another protocol is not a socks profile.
    expect(plainDefaultPort({ protocol: 'hysteria', config: { subprotocol: 'socks' } })).toBeNull();
    expect(plainDefaultPort(null)).toBeNull();
    expect(plainDefaultPort(undefined)).toBeNull();
  });
});
