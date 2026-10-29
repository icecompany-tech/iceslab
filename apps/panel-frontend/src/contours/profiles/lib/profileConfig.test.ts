import { describe, expect, it } from 'vitest';
import { PROFILE_CONFIG_KEYS, PROTOCOL_NAMES, type ProtocolName } from '@iceslab/shared';
import type { Profile } from '@/lib/domain/profiles';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig';
import { SEEDED } from '@/contours/profiles/lib/seededConfigs';

/**
 * A-285: a profile whose stored config holds every key the form looks after
 * (PROFILE_CONFIG_KEYS[protocol].form in shared, the list itself and not a
 * copy) goes through defaults() and the save's config builder, and comes back
 * with every one of those keys and its value. A key the form has no field for,
 * or a field defaults() does not seed, would be erased by the next save: the
 * server's PUT replaces the config whole.
 *
 * Some keys are sent only for the security or the network that uses them, so
 * xray is seeded twice (reality over xhttp, tls over grpc) and the keys are the
 * union of both saves; each save alone sends only listed keys.
 */
const profileOf = (protocol: ProtocolName, config: Record<string, unknown>) =>
  ({ id: 'p1', protocol, name: 'p', description: null, enabled: true, engine: null, config }) as unknown as Profile;

describe('profileConfigOf against PROFILE_CONFIG_KEYS.form (A-285)', () => {
  it('every protocol of the contract has a seeded profile here', () => {
    expect(Object.keys(SEEDED).sort()).toEqual([...PROTOCOL_NAMES].sort());
  });

  for (const protocol of PROTOCOL_NAMES) {
    it(`${protocol}: defaults() seeds every form key and the save sends it back unchanged`, () => {
      const form = [...PROFILE_CONFIG_KEYS[protocol].form].sort();
      const sent = new Set<string>();
      for (const stored of SEEDED[protocol]) {
        const config = profileConfigOf(defaults(profileOf(protocol, stored)));
        for (const key of Object.keys(config)) {
          expect(form, `${protocol}: ${key} is sent but not in the shared list`).toContain(key);
          sent.add(key);
          // Seeded from the stored value, not from a default of its own.
          if (key in stored) expect(config[key], `${protocol}.${key}`).toEqual(stored[key]);
        }
      }
      expect([...sent].sort()).toEqual(form);
    });
  }

  it('SOCKS5 and HTTP send only listed keys', () => {
    for (const subprotocol of ['socks', 'http']) {
      const config = profileConfigOf(defaults(profileOf('xray', { subprotocol, security: 'none', network: 'raw' })));
      for (const key of Object.keys(config)) expect(PROFILE_CONFIG_KEYS.xray.form).toContain(key);
    }
  });
});
