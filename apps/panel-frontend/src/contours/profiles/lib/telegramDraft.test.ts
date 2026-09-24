import { describe, expect, it } from 'vitest';
import {
  EMPTY_TELEGRAM_DRAFT,
  generateWebSecret,
  webDraftFromRecipe,
  webLinkFacts,
} from '@/contours/profiles/lib/telegramDraft';

// Both links are the reference relay's own examples (tproxy-server README):
// the page must print what Telegram documents, not what we assume it accepts.
const ROOT_SECRET = '000102030405060708090a0b0c0d0e0f';
const PATH_SECRET_HEX = '8561944064fc730cbfa4473562d8ec59';

describe('webLinkFacts', () => {
  it('builds the root link from host and hex, as the reference documents it', () => {
    expect(webLinkFacts({ host: 'proxy.example.com', secret: ROOT_SECRET, path: '' })).toEqual({
      kind: 'link',
      link: `https://t.me/webproxy?server=proxy.example.com&secret=${ROOT_SECRET}`,
    });
  });

  it('with a base path encodes the path into server and turns the secret into 0x70 base64url', () => {
    expect(
      webLinkFacts({ host: 'proxy.example.com', secret: PATH_SECRET_HEX, path: '/phcf2vfe7zgbrslg/' }),
    ).toEqual({
      kind: 'link',
      link: 'https://t.me/webproxy?server=proxy.example.com%2Fphcf2vfe7zgbrslg&secret=cIVhlEBk_HMMv6RHNWLY7Fk',
    });
  });

  it('waits, without blaming anything, while host or secret is empty', () => {
    expect(webLinkFacts({ host: '', secret: '', path: '' })).toEqual({ kind: 'wait', missing: ['host', 'secret'] });
    expect(webLinkFacts({ host: 'proxy.example.com', secret: ' ', path: '' })).toEqual({
      kind: 'wait',
      missing: ['secret'],
    });
  });

  it('refuses a host that carries a scheme, a port or a path', () => {
    for (const host of ['https://proxy.example.com', 'proxy.example.com:443', 'proxy.example.com/x', 'localhost']) {
      expect(webLinkFacts({ host, secret: ROOT_SECRET, path: '' })).toEqual({ kind: 'bad', field: 'host' });
    }
  });

  it('refuses a secret that is not 32 hex characters, and a path with a character a URL would mangle', () => {
    expect(webLinkFacts({ host: 'proxy.example.com', secret: 'abc', path: '' })).toEqual({ kind: 'bad', field: 'secret' });
    expect(webLinkFacts({ host: 'proxy.example.com', secret: ROOT_SECRET, path: 'a b' })).toEqual({
      kind: 'bad',
      field: 'path',
    });
  });
});

describe('generateWebSecret', () => {
  it('prints sixteen bytes as 32 lowercase hex, zero-padded', () => {
    const secret = generateWebSecret((b) => b.map((_, i) => i));
    expect(secret).toBe(ROOT_SECRET);
  });

  it('draws from the browser random source by default', () => {
    const a = generateWebSecret();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(generateWebSecret()).not.toBe(a);
  });
});

describe('webDraftFromRecipe: a recipe from anywhere fills only the four fields', () => {
  it('only strings, only known keys, a carrier only from the list', () => {
    const base = { ...EMPTY_TELEGRAM_DRAFT.web, host: 'keep.example.com' };
    expect(
      webDraftFromRecipe(base, {
        webHostname: 7,
        webSecret: 'cd'.repeat(16),
        webBasePath: 'p',
        webCarrier: 'carrier-pigeon',
        xrayNetwork: 'ws',
        host: 'x',
      }),
    ).toEqual({ host: 'keep.example.com', secret: 'cd'.repeat(16), path: 'p', carrier: 'https' });
  });

  it('an empty recipe changes nothing', () => {
    expect(webDraftFromRecipe(EMPTY_TELEGRAM_DRAFT.web, {})).toEqual(EMPTY_TELEGRAM_DRAFT.web);
  });
});