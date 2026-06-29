import { describe, it, expect } from 'vitest';
import {
  clientIdToReserved,
  parseWarpRegistration,
  registerWarpDevice,
} from './warp.service.js';

describe('clientIdToReserved', () => {
  it('decodes a base64 client_id to its first 3 bytes', () => {
    // base64 of the bytes [1,2,3] is "AQID".
    expect(clientIdToReserved('AQID')).toEqual([1, 2, 3]);
  });

  it('returns [] for empty or too-short client_id', () => {
    expect(clientIdToReserved('')).toEqual([]);
    expect(clientIdToReserved('AQ')).toEqual([]); // decodes to 1 byte
  });
});

describe('parseWarpRegistration', () => {
  const sample = {
    id: 'device-123',
    token: 'api-token',
    account: { license: 'LIC-KEY' },
    config: {
      client_id: 'AQID', // -> reserved [1,2,3]
      interface: { addresses: { v4: '172.16.0.2', v6: '2606:4700:110:abcd::1' } },
      peers: [
        { public_key: 'PEER-PUB', endpoint: { host: 'engage.cloudflareclient.com:2408' } },
      ],
    },
  };

  it('maps the response into WarpCredentials', () => {
    const c = parseWarpRegistration(sample, 'MY-SECRET');
    expect(c.secretKey).toBe('MY-SECRET');
    expect(c.publicKey).toBe('PEER-PUB');
    expect(c.address).toEqual(['172.16.0.2/32', '2606:4700:110:abcd::1/128']);
    expect(c.endpoint).toBe('engage.cloudflareclient.com:2408');
    expect(c.reserved).toEqual([1, 2, 3]);
    expect(c.clientId).toBe('AQID');
    expect(c.deviceId).toBe('device-123');
    expect(c.token).toBe('api-token');
    expect(c.license).toBe('LIC-KEY');
  });

  it('omits the v6 address when absent', () => {
    const noV6 = {
      ...sample,
      config: { ...sample.config, interface: { addresses: { v4: '172.16.0.2' } } },
    };
    expect(parseWarpRegistration(noV6, 's').address).toEqual(['172.16.0.2/32']);
  });

  it('throws on an incomplete config', () => {
    expect(() => parseWarpRegistration({ config: {} }, 's')).toThrow();
    expect(() => parseWarpRegistration({}, 's')).toThrow();
  });
});

describe('registerWarpDevice', () => {
  it('posts the registration body and parses the response', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        json: async () => ({
          id: 'd',
          token: 't',
          account: { license: 'l' },
          config: {
            client_id: 'AQID',
            interface: { addresses: { v4: '172.16.0.2' } },
            peers: [{ public_key: 'P', endpoint: { host: 'h:2408' } }],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const c = await registerWarpDevice({
      fetchImpl: fakeFetch,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(captured?.url).toBe('https://api.cloudflareclient.com/v0a884/reg');
    const body = JSON.parse(String(captured?.init.body));
    expect(body.tos).toBe('2026-01-01T00:00:00.000Z');
    expect(typeof body.key).toBe('string'); // generated WireGuard public key
    expect(body.type).toBe('Android');
    expect(c.endpoint).toBe('h:2408');
    expect(c.reserved).toEqual([1, 2, 3]);
  });

  it('throws on a non-ok HTTP status', async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })) as unknown as typeof fetch;
    await expect(registerWarpDevice({ fetchImpl: fakeFetch })).rejects.toThrow(/429/);
  });
});
