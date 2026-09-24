import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO_BUILTIN, geoBuiltinUrl } from '@iceslab/shared';
import {
  GeoDatError,
  GeoTagUnknownError,
  formatIp,
  geoTagList,
  geoipRuleSet,
  geositeRuleSet,
  parseGeoDat,
  type RuleSetJson,
} from './geo-dat.js';

import {
  FULL,
  PLAIN,
  REGEX,
  ROOT,
  bytes,
  cidr,
  datFile as file,
  domain,
  geoip,
  site,
  str,
} from '../../../tests/helpers/geo-dat.js';

/**
 * The panel's reader of v2fly geo files. Files built by hand, so every branch
 * is pinned to bytes; then, when the real files are at hand, the conversion is
 * compared with sing-box's own export of the same release.
 */

const siteFile = file(
  site(
    'CATEGORY-X',
    domain(PLAIN, 'ads'),
    domain(REGEX, '^a\\.'),
    domain(ROOT, 'example.com'),
    domain(ROOT, 'cn'),
    domain(FULL, 'www.full.com'),
    domain(ROOT, 'example.com'),
  ),
  site(
    'GOOGLE',
    domain(ROOT, 'a.com', ['ads']),
    domain(ROOT, 'b.com', ['ads', 'cn']),
    domain(ROOT, 'c.com'),
    domain(ROOT, 'd.com', ['Ads']),
  ),
);

describe('geosite: types map as sing-geosite converts them', () => {
  const index = parseGeoDat(siteFile, 'geosite');

  it('plain, regex, domain (with and without a dot), full; de-duplicated and sorted', () => {
    expect(geositeRuleSet(siteFile, index, 'category-x')).toEqual({
      version: 2,
      rules: [
        {
          domain: ['example.com', 'www.full.com'],
          domain_suffix: ['.cn', '.example.com'],
          domain_keyword: ['ads'],
          domain_regex: ['^a\\.'],
        },
      ],
    });
  });

  it('the tag is read case-blind, the way xray upper-cases it', () => {
    expect(geositeRuleSet(siteFile, index, 'CATEGORY-X')).toEqual(geositeRuleSet(siteFile, index, 'category-x'));
  });

  it('@attr filters, several are AND, a key with capitals is never matched (xray compares bytes)', () => {
    const d = (tag: string) => (geositeRuleSet(siteFile, index, tag).rules[0]?.domain ?? []).sort();
    expect(d('google@ads')).toEqual(['a.com', 'b.com']);
    expect(d('google@ads@cn')).toEqual(['b.com']);
    expect(d('google@ADS')).toEqual(['a.com', 'b.com']);
    expect(d('google')).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
  });

  it('a filter that leaves nothing matches nothing: no rules, never a rule without conditions', () => {
    expect(geositeRuleSet(siteFile, index, 'google@nope')).toEqual({ version: 2, rules: [] });
  });

  it('lists the tags lower case with their counts and the attributes a rule can name', () => {
    expect(geoTagList(index)).toEqual([
      { name: 'category-x', entries: 6, attrs: [] },
      { name: 'google', entries: 4, attrs: ['ads', 'cn'] },
    ]);
  });

  it('an unknown tag is its own error, not an empty list', () => {
    expect(() => geositeRuleSet(siteFile, index, 'nope')).toThrow(GeoTagUnknownError);
  });
});

describe('only the tags xray can reach are tags', () => {
  it('lower-case code, repeated code, code not first: all set aside by name', () => {
    const f = file(
      site('OK', domain(ROOT, 'a.com')),
      site('lower', domain(ROOT, 'b.com')),
      site('OK', domain(ROOT, 'c.com')),
      bytes(1, [...domain(ROOT, 'd.com'), ...str(1, 'LATE')]),
    );
    const index = parseGeoDat(f, 'geosite');
    expect(index.tags.map((t) => t.name)).toEqual(['ok']);
    expect(index.unreachable).toEqual(['lower', 'OK', 'LATE']);
    // The first OK wins, as xray's scan stops there.
    expect(geositeRuleSet(f, index, 'ok').rules[0]!.domain).toEqual(['a.com']);
  });
});

describe('integrity: a broken file is refused with words', () => {
  const refused = (buf: Uint8Array, kind: 'geosite' | 'geoip' = 'geosite') => {
    try {
      parseGeoDat(buf, kind);
    } catch (err) {
      expect(err).toBeInstanceOf(GeoDatError);
      return (err as Error).message;
    }
    throw new Error('parsed');
  };

  it('cut inside an entry', () => {
    expect(refused(siteFile.subarray(0, siteFile.length - 3))).toMatch(/runs past the end|ends inside/);
  });

  it('text that is not protobuf', () => {
    expect(refused(new TextEncoder().encode('not a dat file at all'))).toMatch(/^not a valid geosite file/);
  });

  it('an empty file', () => {
    expect(refused(new Uint8Array())).toMatch(/holds no entries/);
  });

  it('a domain type no engine knows', () => {
    expect(refused(file(site('X', domain(7, 'a.com'))))).toMatch(/domain type 7/);
  });

  it('an address of five bytes', () => {
    expect(refused(file(geoip('X', cidr([1, 2, 3, 4, 5], 8))), 'geoip')).toMatch(/5 bytes/);
  });

  it('a prefix longer than the address', () => {
    expect(refused(file(geoip('X', cidr([1, 2, 3, 4], 33))), 'geoip')).toMatch(/\/33/);
  });

  it('a file of the other kind says which it is', () => {
    const ipFile = file(geoip('RU', cidr([1, 2, 3, 0], 24)));
    expect(refused(ipFile, 'geosite')).toBe('this is a geoip file, the set is geosite');
    expect(refused(siteFile, 'geoip')).toBe('this is a geosite file, the set is geoip');
  });
});

describe('geoip', () => {
  const v6 = (...g: number[]) => g.flatMap((x) => [x >> 8, x & 0xff]);
  const f = file(
    geoip(
      'RU',
      cidr([1, 2, 3, 0], 24),
      cidr(v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
      cidr([1, 2, 3, 0], 24),
    ),
  );
  const index = parseGeoDat(f, 'geoip');

  it('CIDRs in file order, de-duplicated; `!tag` inverts', () => {
    expect(geoipRuleSet(f, index, 'ru')).toEqual({ version: 2, rules: [{ ip_cidr: ['1.2.3.0/24', '2001:db8::/32'] }] });
    expect(geoipRuleSet(f, index, '!RU')).toEqual({
      version: 2,
      rules: [{ ip_cidr: ['1.2.3.0/24', '2001:db8::/32'], invert: true }],
    });
  });

  it('IPv6 is written the RFC 5952 way', () => {
    const ip = (...g: number[]) => formatIp(Uint8Array.from(v6(...g)));
    expect(ip(0, 0, 0, 0, 0, 0, 0, 0)).toBe('::');
    expect(ip(0, 0, 0, 0, 0, 0, 0, 1)).toBe('::1');
    expect(ip(0x2001, 0xdb8, 0, 1, 0, 0, 0, 1)).toBe('2001:db8:0:1::1');
    expect(ip(1, 0, 0, 2, 0, 0, 0, 3)).toBe('1:0:0:2::3');
    expect(ip(1, 0, 2, 0, 3, 0, 4, 0)).toBe('1:0:2:0:3:0:4:0');
    expect(ip(0xfe80, 0, 0, 0, 0, 0, 0, 0)).toBe('fe80::');
  });
});

/**
 * The real release, when the files are at hand: GEO_DLC_DAT is v2fly
 * domain-list-community 20260922112956 `dlc.dat` (the GEO_BUILTIN pin) and
 * SING_GEOSITE_DB is SagerNet/sing-geosite 20260922112956 `geosite.db`, built
 * by their converter from that same file. Three tags whose composition
 * sing-geosite does not rewrite (filterTags, mergeTags) must come out equal,
 * key by key. Both files are megabytes and stay out of the repo.
 *
 * A laptop without them skips this; CI does not. There the files come from a
 * cached step, and a missing one is a failure, not a quiet skip.
 */
const DLC = process.env.GEO_DLC_DAT ?? '';
const SING_DB = process.env.SING_GEOSITE_DB ?? '';
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ?? ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ?? '';
const HAVE_FILES = Boolean(DLC && SING_DB && SINGBOX_BIN);
const IN_CI = process.env.CI === 'true';

/** sing-geosite's release built from the pinned dlc, and its geosite.db. */
const SING_GEOSITE = {
  url: 'https://github.com/SagerNet/sing-geosite/releases/download/20260922112956/geosite.db',
  sha256: '48cbdf0fea7467b9ceb1d347474a2f704747027ee9063fe1884f427de341c9e9',
};

describe('CI compares against the release the panel pins', () => {
  const ci = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../.github/workflows/ci.yml'),
    'utf8',
  );
  it('the dlc.dat of GEO_BUILTIN, by the same sha256, and sing-geosite of the same tag', () => {
    const dlc = GEO_BUILTIN.geosite;
    expect(ci).toContain(geoBuiltinUrl(dlc));
    expect(ci).toContain(dlc.sha256);
    expect(SING_GEOSITE.url).toContain(`/${dlc.tag}/`);
    expect(ci).toContain(SING_GEOSITE.url);
    expect(ci).toContain(SING_GEOSITE.sha256);
  });
});

describe.runIf(HAVE_FILES || IN_CI)('the pinned release against sing-box export', () => {
  it('has the files it compares', () => {
    expect(HAVE_FILES, 'CI must set GEO_DLC_DAT, SING_GEOSITE_DB and SINGBOX_BIN (the "Fetch the pinned geo lists" step)').toBe(true);
  });

  const buf = new Uint8Array(DLC ? readFileSync(DLC) : []);
  const index = DLC ? parseGeoDat(buf, 'geosite') : null;
  const dir = mkdtempSync(join(tmpdir(), 'geo-'));

  const theirs = (tag: string): RuleSetJson => {
    const out = join(dir, `${tag}.json`);
    execFileSync(SINGBOX_BIN, ['geosite', '-f', SING_DB, 'export', tag, '-o', out]);
    return JSON.parse(readFileSync(out, 'utf8')) as RuleSetJson;
  };
  const keys = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'] as const;
  const flat = (rs: RuleSetJson) =>
    Object.fromEntries(keys.map((k) => [k, [...new Set(rs.rules.flatMap((r) => r[k] ?? []))].sort()]));

  it.each(['category-ads-all', 'category-ru', 'google@ads'])('%s: the same domains under the same keys', (tag) => {
    const ours = flat(geositeRuleSet(buf, index!, tag));
    expect(ours).toEqual(flat(theirs(tag)));
    expect(Object.values(ours).flat().length).toBeGreaterThan(0);
  });

  it('the same file cut at 1 MB of 2.2 is refused, where xray -test passed it for an early tag', () => {
    expect(() => parseGeoDat(buf.subarray(0, 1_000_000), 'geosite')).toThrow(GeoDatError);
  });
});
