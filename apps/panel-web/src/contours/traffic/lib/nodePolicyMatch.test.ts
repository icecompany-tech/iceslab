import { describe, expect, it } from 'vitest';
import { isAddressToken } from '@/contours/traffic/lib/nodePolicyMatch';

describe('isAddressToken (A-103)', () => {
  it('geoip:, ext-ip:, a bare address and a bare CIDR are addresses', () => {
    for (const t of ['geoip:ru', 'ext-ip:corp:office', '1.2.3.4', '10.0.0.0/8', '2001:db8::/32']) {
      expect(isAddressToken(t), t).toBe(true);
    }
  });

  it('«ip:1.2.3.4» and «cidr:…» are not addresses: the server refuses those prefixes', () => {
    expect(isAddressToken('ip:1.2.3.4')).toBe(false);
    expect(isAddressToken('cidr:10.0.0.0/8')).toBe(false);
  });

  it('domain matchers stay domains', () => {
    for (const t of ['geosite:ru', 'domain:example.com', 'example.com', 'ext:corp:sites']) {
      expect(isAddressToken(t), t).toBe(false);
    }
  });
});
