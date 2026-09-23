import { describe, it, expect } from 'vitest';
import {
  CHAIN_SOCKS_BASE,
  CHAIN_TPROXY_MARK_BASE,
  CHAIN_TPROXY_PORT,
  chainSocksPort,
  chainTProxyMark,
} from './chain.ports.js';
import { LINK_PORT_BASE } from './cascade.config.js';
import { MAX_CASCADE_LINKS, MAX_DIRECTION_TAG } from './cascade.schemas.js';

/**
 * The numbers the TPROXY hand-off of an AmneziaWG entry lives on, phase 7.
 *
 * One number is mark AND routing table (decision of 23.09), so every property
 * a table number must have is asked of the mark.
 */
describe('the tproxy mark of an awg interface', () => {
  it('is never a table the host cannot lose', () => {
    // 0 is "unspecified", 253-255 are default, main and local: a local default
    // route in one of those takes the whole host off the network.
    for (const port of [1, 253, 254, 255, 443, 51820, 65535]) {
      const mark = chainTProxyMark(port);
      expect(mark).toBeGreaterThan(255);
      expect(mark).toBeLessThan(2 ** 31);
    }
  });

  it('differs between two interfaces of one node', () => {
    // Two awg interfaces cannot share a listen port, so they cannot share a
    // mark, so the PostDown of one cannot take the other's ip rule.
    expect(chainTProxyMark(51820)).not.toBe(chainTProxyMark(51821));
    expect(chainTProxyMark(443)).toBe(CHAIN_TPROXY_MARK_BASE + 443);
  });

  it('refuses what is not a port instead of minting a mark from it', () => {
    for (const bad of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(() => chainTProxyMark(bad)).toThrow(RangeError);
    }
  });
});

describe('the tproxy listener', () => {
  it('sits in neither the link range nor the socks range', () => {
    const linkTop = LINK_PORT_BASE + MAX_CASCADE_LINKS;
    const socksTop = chainSocksPort(MAX_DIRECTION_TAG);
    expect(CHAIN_TPROXY_PORT).toBeGreaterThan(linkTop);
    expect(CHAIN_TPROXY_PORT).toBeLessThan(CHAIN_SOCKS_BASE);
    expect(socksTop).toBeGreaterThan(CHAIN_TPROXY_PORT);
  });
});
