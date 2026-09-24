import { describe, it, expect } from 'vitest';
import { Reader } from 'mmdb-lib';
import { ROOT, datFile, domain, site } from '../../../tests/helpers/geo-dat.js';
import { buildMmdb, country } from '../../../tests/helpers/mmdb.js';
import { GeoDatError, geoTagList, geoipRuleSet, geositeRuleSet, parseGeoDat } from './geo-dat.js';
import { detectGeoFormat, mmdbCountries, parseCidr, toGeoDat } from './geo-formats.js';

/**
 * Phase 9.4: a geo set may come as a sing-box rule-set JSON or a MaxMind
 * database, recognised by its bytes and turned into a v2fly `.dat`, which is
 * all the rest of the panel and the nodes ever see.
 */
const json = (doc: unknown) => new TextEncoder().encode(JSON.stringify(doc));
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GeoDatError);
    return (err as Error).message;
  }
  throw new Error('accepted');
};

describe('recognising the format by its bytes', () => {
  it('a .dat, a rule-set JSON, a MaxMind database', () => {
    expect(detectGeoFormat(datFile(site('ADS', domain(ROOT, 'a.com'))))).toBe('dat');
    expect(detectGeoFormat(json({ version: 2, rules: [] }))).toBe('rule-set-json');
    expect(detectGeoFormat(new TextEncoder().encode('\n  {"version":1,"rules":[]}'))).toBe('rule-set-json');
    expect(detectGeoFormat(buildMmdb(4, [{ ip: [1, 2, 3, 0], prefix: 24, data: country('RU') }]))).toBe('mmdb');
  });

  it('a list whose first entry is 123 bytes long starts "0a 7b" and is still a .dat', () => {
    const entry = site('X', domain(ROOT, 'a'.repeat(110) + '.com'));
    expect(entry[0]).toBe(0x0a);
    expect(entry[1]).toBe(0x7b);
    expect(detectGeoFormat(Uint8Array.from(entry))).toBe('dat');
  });
});

describe('a sing-box rule-set JSON', () => {
  const doc = {
    version: 3,
    rules: [
      { domain: ['exact.example'], domain_suffix: ['.ads.example', 'tracker.example'] },
      { domain_keyword: 'doubleclick', domain_regex: ['^ad[0-9]+\\.'] },
      { ip_cidr: ['10.0.0.0/8', '2001:db8::/32', '192.0.2.1'] },
    ],
  };

  it('as geosite: one tag, the set name, with the domains the chain gets back unchanged', () => {
    const { dat, format } = toGeoDat(json(doc), 'geosite', 'mylist');
    expect(format).toBe('rule-set-json');
    const index = parseGeoDat(dat, 'geosite');
    expect(geoTagList(index).map((t) => t.name)).toEqual(['mylist']);
    expect(geositeRuleSet(dat, index, 'mylist')).toEqual({
      version: 2,
      rules: [
        {
          // domain_suffix ".x" reads back as domain x plus suffix .x: one
          // name wider, the v2fly `domain` also matches the name itself.
          domain: ['ads.example', 'exact.example', 'tracker.example'],
          domain_suffix: ['.ads.example', '.tracker.example'],
          domain_keyword: ['doubleclick'],
          domain_regex: ['^ad[0-9]+\\.'],
        },
      ],
    });
  });

  it('as geoip: the networks, a bare address as a host route', () => {
    const { dat } = toGeoDat(json(doc), 'geoip', 'mylist');
    const index = parseGeoDat(dat, 'geoip');
    expect(geoipRuleSet(dat, index, 'mylist')).toEqual({
      version: 2,
      rules: [{ ip_cidr: ['10.0.0.0/8', '2001:db8::/32', '192.0.2.1/32'] }],
    });
  });

  it('refuses in words what a v2fly list cannot carry', () => {
    expect(refusal(() => toGeoDat(json({ version: 4, rules: [] }), 'geosite', 'x'))).toMatch(/version 4/);
    expect(refusal(() => toGeoDat(json({ version: 2, rules: [{ type: 'logical', mode: 'and', rules: [] }] }), 'geosite', 'x'))).toMatch(
      /logical rule/,
    );
    expect(refusal(() => toGeoDat(json({ version: 2, rules: [{ domain: ['a.com'], invert: true }] }), 'geosite', 'x'))).toMatch(/inverted/);
    expect(refusal(() => toGeoDat(json({ version: 2, rules: [{ domain: ['a.com'], port: [443] }] }), 'geosite', 'x'))).toMatch(
      /"port"/,
    );
    expect(refusal(() => toGeoDat(json({ version: 2, rules: [{ ip_cidr: ['10.0.0.0/8'] }] }), 'geosite', 'x'))).toMatch(
      /no domain rules/,
    );
    expect(refusal(() => toGeoDat(json({ version: 2, rules: [{ ip_cidr: ['not-an-ip'] }] }), 'geoip', 'x'))).toMatch(/not-an-ip/);
    expect(refusal(() => toGeoDat(new TextEncoder().encode('{"version": 2, "rules": ['), 'geosite', 'x'))).toMatch(
      /not a valid rule-set JSON/,
    );
  });
});

describe('a MaxMind country database', () => {
  it('IPv4: one tag per country, lower case, its networks', () => {
    const db = buildMmdb(4, [
      { ip: [1, 2, 3, 0], prefix: 24, data: country('RU') },
      { ip: [5, 6, 0, 0], prefix: 16, data: country('RU') },
      { ip: [9, 9, 9, 0], prefix: 24, data: country('NL') },
      // A network with no country but a registered one.
      { ip: [8, 8, 0, 0], prefix: 16, data: { registered_country: { iso_code: 'US' } } },
      // And one that names neither: left out.
      { ip: [7, 0, 0, 0], prefix: 8, data: { continent: { code: 'EU' } } },
    ]);
    // The fixture is a database mmdb-lib itself reads.
    expect((new Reader(db).get('1.2.3.4') as { country: { iso_code: string } }).country.iso_code).toBe('RU');

    const { dat, format } = toGeoDat(db, 'geoip', 'maxmind');
    expect(format).toBe('mmdb');
    const index = parseGeoDat(dat, 'geoip');
    expect(geoTagList(index).map((t) => t.name)).toEqual(['nl', 'ru', 'us']);
    expect(geoipRuleSet(dat, index, 'ru').rules[0]!.ip_cidr!.sort()).toEqual(['1.2.3.0/24', '5.6.0.0/16']);
  });

  it('IPv6: IPv4 read under ::/96, its aliases not walked twice', () => {
    const v6 = (...g: number[]) => g.flatMap((x) => [x >> 8, x & 0xff]);
    const db = buildMmdb(6, [
      { ip: [...Array(12).fill(0), 1, 2, 3, 0], prefix: 120, data: country('RU') },
      { ip: [...Array(10).fill(0), 0xff, 0xff, 1, 2, 3, 0], prefix: 120, data: country('RU') },
      { ip: [0x20, 0x02, 1, 2, 3, 0, ...Array(10).fill(0)], prefix: 40, data: country('RU') },
      { ip: v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), prefix: 32, data: country('DE') },
    ]);
    const countries = mmdbCountries(db);
    expect(countries.get('RU')).toEqual([{ ip: Uint8Array.from([1, 2, 3, 0]), prefix: 24 }]);
    expect(countries.get('DE')).toEqual([{ ip: Uint8Array.from(v6(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0)), prefix: 32 }]);
  });

  it('is a geoip list, and says so to a geosite set', () => {
    const db = buildMmdb(4, [{ ip: [1, 2, 3, 0], prefix: 24, data: country('RU') }]);
    expect(refusal(() => toGeoDat(db, 'geosite', 'x'))).toBe(
      'this is a MaxMind database, which is a geoip list, and the set is geosite',
    );
  });
});

describe('addresses', () => {
  it.each([
    ['10.0.0.0/8', [10, 0, 0, 0], 8],
    ['192.0.2.1', [192, 0, 2, 1], 32],
    ['::ffff:1.2.3.4/128', [...Array(10).fill(0), 0xff, 0xff, 1, 2, 3, 4], 128],
  ])('%s', (text, ip, prefix) => {
    expect(parseCidr(text)).toEqual({ ip: Uint8Array.from(ip as number[]), prefix });
  });
  it('refuses what is not one', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('example.com')).toBeNull();
  });
});
