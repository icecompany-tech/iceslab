import { describe, expect, it } from 'vitest';
import { PROFILE_CONFIG_KEYS, PROTOCOL_NAMES, profileConfigKeys } from '@iceslab/shared';
import { PROTOCOL_CONFIG_SCHEMAS } from '../inbounds/inbounds.schemas.js';

/**
 * A-285: every top-level key of a profile's config schema is looked after by
 * someone: the form sends it, the server keeps the stored value, or the push
 * sets it (PROFILE_CONFIG_KEYS in shared). A key in a schema and in none of
 * the three is erased by the next save of the profile form, which builds the
 * config from its fields while the PUT replaces it whole.
 */

/** The object shape under whatever wraps it (a refine, a pipe, a default). */
function shapeOf(schema: unknown): Record<string, unknown> {
  let cur = schema as { shape?: Record<string, unknown>; def?: { in?: unknown; innerType?: unknown; schema?: unknown } };
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.shape) return cur.shape;
    cur = (cur.def?.in ?? cur.def?.innerType ?? cur.def?.schema) as typeof cur;
  }
  throw new Error('no object shape under the schema');
}

describe('the keys of each profile config', () => {
  it('has a list for every protocol, and a schema for every list', () => {
    expect(Object.keys(PROFILE_CONFIG_KEYS).sort()).toEqual([...PROTOCOL_NAMES].sort());
    expect(Object.keys(PROTOCOL_CONFIG_SCHEMAS).sort()).toEqual([...PROTOCOL_NAMES].sort());
  });

  it.each([...PROTOCOL_NAMES])('%s: the schema keys are exactly form + kept by the server + set by the push', (protocol) => {
    const schemaKeys = Object.keys(shapeOf(PROTOCOL_CONFIG_SCHEMAS[protocol])).sort();
    expect(profileConfigKeys(protocol).sort()).toEqual(schemaKeys);
  });

  it('no key is in two lists', () => {
    for (const protocol of PROTOCOL_NAMES) {
      const keys = profileConfigKeys(protocol);
      expect(new Set(keys).size, protocol).toBe(keys.length);
    }
  });
});
