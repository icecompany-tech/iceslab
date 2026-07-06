import { describe, expect, it } from 'vitest';
import { parseRecipe } from './recipes.schemas.js';
import { parseRecipes } from './recipes.registry.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

// A minimal well-formed recipe the validators accept.
const valid = {
  schemaVersion: 1,
  id: 'xray-test',
  protocol: 'xray',
  emoji: '🛡',
  name: 'Test',
  description: 'desc',
  details: 'details',
  dpiResistance: 5,
  speed: 5,
  apply: { xrayNetwork: 'grpc', xrayFingerprint: 'firefox' },
};

describe('parseRecipe', () => {
  it('accepts a well-formed recipe', () => {
    const r = parseRecipe(valid);
    expect(r).not.toBeNull();
    expect(r?.id).toBe('xray-test');
  });

  it('rejects an unknown schemaVersion (shape may have changed)', () => {
    expect(parseRecipe({ ...valid, schemaVersion: 2 })).toBeNull();
  });

  it('rejects a non-slug id', () => {
    expect(parseRecipe({ ...valid, id: 'Bad ID' })).toBeNull();
  });

  it('rejects a non-primitive apply value', () => {
    // A recipe may only set scalar field values, never structured data.
    expect(parseRecipe({ ...valid, apply: { x: { nested: 1 } } })).toBeNull();
  });

  it('rejects an unknown randomize kind', () => {
    expect(
      parseRecipe({ ...valid, randomize: [{ field: 'x', kind: 'exec' }] }),
    ).toBeNull();
  });

  it('rejects a missing required field', () => {
    const { name, ...noName } = valid;
    void name;
    expect(parseRecipe(noName)).toBeNull();
  });

  it('rejects a rating outside 1-5', () => {
    expect(parseRecipe({ ...valid, dpiResistance: 9 })).toBeNull();
  });

  it('rejects apply that sets a common profile field', () => {
    // A recipe must only tune protocol-specific fields, never flip protocol /
    // engine or disable / rename the profile.
    expect(parseRecipe({ ...valid, apply: { protocol: 'hysteria' } })).toBeNull();
    expect(parseRecipe({ ...valid, apply: { enabled: false } })).toBeNull();
    expect(parseRecipe({ ...valid, apply: { engine: 'singbox' } })).toBeNull();
  });
});

describe('parseRecipes (registry payload)', () => {
  it('keeps valid, drops invalid, dedupes by id', () => {
    const out = parseRecipes({ recipes: [valid, { bad: true }, valid] });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('xray-test');
  });

  it('accepts a bare array as well as an index object', () => {
    expect(parseRecipes([valid])).toHaveLength(1);
    expect(parseRecipes({ recipes: [valid] })).toHaveLength(1);
  });

  it('version-gates recipes newer than the running panel', () => {
    // 99.0.0 is always newer than any real build (hidden); 0.0.1 always older
    // (kept). The panel version comes from package.json at cwd.
    const out = parseRecipes({
      recipes: [
        { ...valid, id: 'too-new', minPanelVersion: '99.0.0' },
        { ...valid, id: 'ok', minPanelVersion: '0.0.1' },
      ],
    });
    expect(out.map((r) => r.id)).toEqual(['ok']);
  });

  it('returns nothing for a malformed payload', () => {
    expect(parseRecipes('not json object')).toHaveLength(0);
    expect(parseRecipes(null)).toHaveLength(0);
  });
});

describe('assertFetchableUrl (SSRF guard)', () => {
  it('allows a public https URL', () => {
    expect(() =>
      assertFetchableUrl('https://raw.githubusercontent.com/o/r/main/index.json'),
    ).not.toThrow();
  });

  it('rejects non-https schemes', () => {
    expect(() => assertFetchableUrl('http://example.com/x')).toThrow();
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow();
  });

  it('rejects loopback and localhost', () => {
    expect(() => assertFetchableUrl('https://localhost/x')).toThrow();
    expect(() => assertFetchableUrl('https://127.0.0.1/x')).toThrow();
    expect(() => assertFetchableUrl('https://[::1]/x')).toThrow();
  });

  it('rejects private and link-local / metadata ranges', () => {
    expect(() => assertFetchableUrl('https://10.0.0.5/x')).toThrow();
    expect(() => assertFetchableUrl('https://192.168.1.1/x')).toThrow();
    expect(() => assertFetchableUrl('https://172.16.0.1/x')).toThrow();
    expect(() => assertFetchableUrl('https://169.254.169.254/latest/meta-data')).toThrow();
  });

  it('rejects a non-URL string', () => {
    expect(() => assertFetchableUrl('not a url')).toThrow();
  });
});
