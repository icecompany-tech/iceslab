import { describe, expect, it } from 'vitest';
import { PROTOCOL_CONFIG_SCHEMAS } from './inbounds.schemas.js';

/**
 * `tcp` is what xray called the raw transport before v24.9.30.
 *
 * Saved config is jsonb, so nothing rewrote the rows written back then. A
 * profile created before the rename loads fine and cannot be SAVED again: the
 * form refuses a value the operator never typed, on a profile they only opened.
 *
 * The alias is the same shape as the cascade link-protocol dictionary: the old
 * spelling stays legal, gets normalised on write, and only what nothing
 * implements is refused. It cleans itself, one row per re-save, including in
 * databases a migration would never reach.
 */
const xray = PROTOCOL_CONFIG_SCHEMAS.xray;

const base = {
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
};

describe('the old transport spelling', () => {
  it('is accepted and stored as the new one', () => {
    const parsed = xray.parse({ ...base, network: 'tcp' });
    expect(parsed.network).toBe('raw');
  });

  it('leaves the new spelling alone', () => {
    expect(xray.parse({ ...base, network: 'raw' }).network).toBe('raw');
  });

  it('still defaults to raw when nothing is said', () => {
    expect(xray.parse({ ...base }).network).toBe('raw');
  });

  it('does not quietly accept anything else', () => {
    // The alias is one name, not an escape hatch: a transport nothing
    // implements is still refused, and refused by name.
    expect(() => xray.parse({ ...base, network: 'splithttp' })).toThrow();
    expect(() => xray.parse({ ...base, network: 'quic' })).toThrow();
  });

  it('keeps the other transports working', () => {
    for (const network of ['xhttp', 'ws', 'grpc', 'httpupgrade', 'kcp']) {
      expect(xray.parse({ ...base, network }).network).toBe(network);
    }
  });
});
