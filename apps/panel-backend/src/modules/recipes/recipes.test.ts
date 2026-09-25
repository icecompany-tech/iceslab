import { describe, expect, it } from 'vitest';
import { parseRecipe, RecipeSchema } from './recipes.schemas.js';
import { githubRawUrl, parseRecipes } from './recipes.registry.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

// A minimal well-formed recipe the validators accept (schema v2).
const valid = {
  schemaVersion: 2,
  id: 'xray-test',
  engine: 'native',
  protocol: 'xray',
  subprotocol: 'vless',
  emoji: '🛡',
  name: 'Test',
  description: 'desc',
  details: 'details',
  dpiResistance: 5,
  speed: 5,
  apply: { xrayNetwork: 'grpc', xrayFingerprint: 'firefox' },
};

const issues = (raw: unknown) => {
  const res = RecipeSchema.safeParse(raw);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('parseRecipe', () => {
  it('accepts a well-formed recipe, engine and subprotocol kept', () => {
    const r = parseRecipe(valid);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ id: 'xray-test', engine: 'native', protocol: 'xray', subprotocol: 'vless' });
  });

  it('does not read schema v1 any more, nor a version it does not know', () => {
    expect(parseRecipe({ ...valid, schemaVersion: 1 })).toBeNull();
    expect(parseRecipe({ ...valid, schemaVersion: 3 })).toBeNull();
  });

  it('an xray recipe names its subprotocol, one of five', () => {
    const { subprotocol, ...bare } = valid;
    void subprotocol;
    expect(issues(bare)).toEqual([expect.stringMatching(/^subprotocol: an xray recipe names its subprotocol/)]);
    expect(parseRecipe({ ...valid, subprotocol: 'shadowsocks' })).toBeNull();
    for (const sub of ['vless', 'vmess', 'trojan', 'socks', 'http']) {
      expect(parseRecipe({ ...valid, subprotocol: sub }), sub).not.toBeNull();
    }
  });

  it('no other protocol takes a subprotocol', () => {
    const tuic = { ...valid, id: 'tuic-x', engine: 'singbox', protocol: 'tuic', apply: {} };
    const { subprotocol, ...bare } = tuic;
    void subprotocol;
    expect(parseRecipe(bare)).not.toBeNull();
    expect(issues(tuic)).toEqual([expect.stringMatching(/^subprotocol: only an xray recipe takes a subprotocol/)]);
  });

  it('apply.xraySubprotocol, when set, equals the subprotocol', () => {
    expect(parseRecipe({ ...valid, subprotocol: 'socks', apply: { xraySubprotocol: 'socks' } })).not.toBeNull();
    expect(issues({ ...valid, subprotocol: 'socks', apply: { xraySubprotocol: 'http' } })).toEqual([
      expect.stringMatching(/^apply\.xraySubprotocol: .*contradicts subprotocol "socks"/),
    ]);
  });

  it('engine is native or singbox, and required', () => {
    expect(parseRecipe({ ...valid, engine: 'xray' })).toBeNull();
    const { engine, ...bare } = valid;
    void engine;
    expect(parseRecipe(bare)).toBeNull();
  });

  it('takes a protocol the backend does not serve (the screen decides)', () => {
    expect(parseRecipe({ ...valid, id: 'web', protocol: 'telegramweb', subprotocol: undefined, apply: {} })).not.toBeNull();
  });

  it('strips an unknown key instead of refusing the recipe', () => {
    const r = parseRecipe({ ...valid, kind: 'vless-reality', future: 1 });
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('kind');
    expect(r).not.toHaveProperty('future');
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

describe('githubRawUrl', () => {
  it('a GitHub file page is its raw file; everything else is left alone', () => {
    expect(githubRawUrl('https://github.com/o/r/blob/main/recipes/a/b.json')).toBe(
      'https://raw.githubusercontent.com/o/r/main/recipes/a/b.json',
    );
    expect(githubRawUrl('https://github.com/o/r/blob/0123abc/x.json?plain=1#L3')).toBe(
      'https://raw.githubusercontent.com/o/r/0123abc/x.json',
    );
    for (const other of [
      'https://raw.githubusercontent.com/o/r/main/x.json',
      'https://github.com/o/r/tree/main/recipes',
      'http://github.com/o/r/blob/main/x.json',
      'https://example.com/o/r/blob/main/x.json',
      'not a url',
    ]) {
      expect(githubRawUrl(other), other).toBeNull();
    }
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
