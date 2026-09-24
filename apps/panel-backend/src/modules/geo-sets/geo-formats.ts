import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { Reader } from 'mmdb-lib';
import type { GeoSetFormat, GeoSetKind } from '@iceslab/shared';
import { GeoDatError } from './geo-dat.js';

/**
 * The formats a geo set may come in besides a v2fly `.dat` (phase 9.4), and
 * their conversion INTO one. Everything past this file sees a `.dat` only:
 * xray reads it on the node, and the chain's rule-sets are built from it
 * (geo-dat.ts), so a list that came as JSON or as a MaxMind database is the
 * same list on both engines, like every other.
 *
 * The format is recognised by the bytes, never by a file name or a header.
 */

// ---------------------------------------------------------------- recognising

const MMDB_MARKER = Buffer.from('ABCDEF4D61784D696E642E636F6D', 'hex'); // \xAB\xCD\xEF MaxMind.com

export function detectGeoFormat(bytes: Uint8Array): GeoSetFormat {
  // The MaxMind metadata marker sits in the last 128 KiB by the format's own
  // rule; a v2fly list has no reason to carry these 14 bytes.
  const tail = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).subarray(Math.max(0, bytes.length - 128 * 1024));
  if (tail.includes(MMDB_MARKER)) return 'mmdb';
  // JSON starts with `{` after optional whitespace. A protobuf list starts
  // with 0x0a, the tag of field 1, which is also a newline: a first 0x0a is
  // JSON only if the text after it parses, since "0a 7b" is also a list whose
  // first entry is 123 bytes long.
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++;
  if (bytes[i] !== 0x7b) return 'dat';
  if (bytes[0] !== 0x0a) return 'rule-set-json';
  try {
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return 'rule-set-json';
  } catch {
    return 'dat';
  }
}

// ---------------------------------------------------------------- writing a .dat

const utf8 = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}

/** Length-delimited field `field` around `body`. */
function bytesField(field: number, body: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([...varint(field * 8 + 2), ...varint(body.length)]), body]);
}

const DOMAIN_TYPE = { plain: 0, regex: 1, domain: 2, full: 3 } as const;

export interface GeoSiteDomain {
  type: keyof typeof DOMAIN_TYPE;
  value: string;
}

export interface GeoCidr {
  ip: Uint8Array;
  prefix: number;
}

/** A GeoSiteList of the given entries, as v2fly writes it. */
export function encodeGeoSiteList(entries: { code: string; domains: GeoSiteDomain[] }[]): Uint8Array {
  return Buffer.concat(
    entries.map((e) =>
      bytesField(
        1,
        Buffer.concat([
          bytesField(1, utf8.encode(e.code)),
          ...e.domains.map((d) =>
            bytesField(
              2,
              Buffer.concat([Buffer.from([0x08, DOMAIN_TYPE[d.type]]), bytesField(2, utf8.encode(d.value))]),
            ),
          ),
        ]),
      ),
    ),
  );
}

/** A GeoIPList of the given entries, as v2fly writes it. */
export function encodeGeoIPList(entries: { code: string; cidrs: GeoCidr[] }[]): Uint8Array {
  return Buffer.concat(
    entries.map((e) =>
      bytesField(
        1,
        Buffer.concat([
          bytesField(1, utf8.encode(e.code)),
          ...e.cidrs.map((c) =>
            bytesField(2, Buffer.concat([bytesField(1, c.ip), Buffer.from([0x10, ...varint(c.prefix)])])),
          ),
        ]),
      ),
    ),
  );
}

// ---------------------------------------------------------------- addresses

function parseIpv6(s: string): Uint8Array {
  const [head, tail] = s.includes('::') ? s.split('::') : [s, undefined];
  const part = (x: string | undefined) => (x ? x.split(':') : []);
  let groups = part(head);
  let back = part(tail);
  // An IPv4 tail ("::ffff:1.2.3.4") is two groups.
  const lastOf = (xs: string[]) => xs[xs.length - 1];
  const expandV4 = (xs: string[]) => {
    const l = lastOf(xs);
    if (!l || !l.includes('.')) return xs;
    const o = l.split('.').map(Number);
    return [...xs.slice(0, -1), ((o[0]! << 8) | o[1]!).toString(16), ((o[2]! << 8) | o[3]!).toString(16)];
  };
  if (tail === undefined) groups = expandV4(groups);
  else back = expandV4(back);
  const fill = tail === undefined ? [] : Array(8 - groups.length - back.length).fill('0');
  const all = [...groups, ...fill, ...back];
  const out = new Uint8Array(16);
  all.forEach((g, i) => {
    const v = parseInt(g, 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

/** "1.2.3.0/24", "2001:db8::/32", or a bare address (a host route). */
export function parseCidr(text: string): GeoCidr | null {
  const [addr, len] = text.trim().split('/');
  if (!addr) return null;
  const family = isIP(addr);
  if (family === 0) return null;
  const ip = family === 4 ? Uint8Array.from(addr.split('.').map(Number)) : parseIpv6(addr);
  const max = ip.length * 8;
  const prefix = len === undefined ? max : Number(len);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { ip, prefix };
}

// ---------------------------------------------------------------- sing-box rule-set JSON

const RULE_SET_FIELDS = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr'] as const;
type RuleSetField = (typeof RULE_SET_FIELDS)[number];

/**
 * A sing-box rule-set source file (version 1 to 3), as the lists of the five
 * fields a v2fly list can carry. The rules of a rule-set are OR-ed, so the
 * union of theirs is the set. What a v2fly list cannot say is refused in
 * words rather than dropped: a logical rule, an inverted one, any other
 * field (a port, a process name...).
 */
export function readRuleSetJson(bytes: Uint8Array): Record<RuleSetField, string[]> {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (err) {
    throw new GeoDatError(`not a valid rule-set JSON: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const d = doc as { version?: unknown; rules?: unknown };
  if (typeof d !== 'object' || d === null || !Array.isArray(d.rules)) {
    throw new GeoDatError('not a sing-box rule-set: no "rules" list', 0);
  }
  if (d.version !== 1 && d.version !== 2 && d.version !== 3) {
    throw new GeoDatError(`rule-set version ${JSON.stringify(d.version)} is none of 1, 2, 3`, 0);
  }
  const out = Object.fromEntries(RULE_SET_FIELDS.map((f) => [f, [] as string[]])) as Record<RuleSetField, string[]>;
  d.rules.forEach((rule: unknown, i: number) => {
    if (typeof rule !== 'object' || rule === null) throw new GeoDatError(`rule ${i} is not an object`, 0);
    for (const [key, value] of Object.entries(rule)) {
      if (key === 'type') {
        if (value !== 'default') throw new GeoDatError(`rule ${i} is a ${String(value)} rule, which a v2fly list cannot carry`, 0);
        continue;
      }
      if (key === 'invert') {
        if (value === true) throw new GeoDatError(`rule ${i} is inverted, which a v2fly list cannot carry`, 0);
        continue;
      }
      if (!(RULE_SET_FIELDS as readonly string[]).includes(key)) {
        throw new GeoDatError(`rule ${i} matches on "${key}", which a v2fly list cannot carry`, 0);
      }
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (typeof v !== 'string' || v === '') throw new GeoDatError(`rule ${i}: "${key}" holds a value that is not a string`, 0);
        out[key as RuleSetField].push(v);
      }
    }
  });
  return out;
}

/**
 * A rule-set JSON as a v2fly list of ONE tag, the set's own name (a rule-set
 * has no tags of its own), in the kind of the set.
 *
 *   geosite: domain -> full, domain_suffix -> domain (the leading dot
 *            dropped: a v2fly `domain` also matches the name itself, one
 *            name wider than sing-box's ".x"), domain_keyword -> plain,
 *            domain_regex -> regex;
 *   geoip:   ip_cidr -> CIDR.
 */
export function ruleSetJsonToDat(bytes: Uint8Array, kind: GeoSetKind, setName: string): Uint8Array {
  const r = readRuleSetJson(bytes);
  const code = setName.toUpperCase();
  if (kind === 'geoip') {
    const cidrs = r.ip_cidr.map((c) => {
      const parsed = parseCidr(c);
      if (!parsed) throw new GeoDatError(`"${c}" is not an address or a network`, 0);
      return parsed;
    });
    if (cidrs.length === 0) throw new GeoDatError('the rule-set has no ip_cidr, and the set is geoip', 0);
    return encodeGeoIPList([{ code, cidrs }]);
  }
  const domains: GeoSiteDomain[] = [
    ...r.domain.map((value) => ({ type: 'full' as const, value })),
    ...r.domain_suffix.map((v) => ({ type: 'domain' as const, value: v.replace(/^\./, '') })),
    ...r.domain_keyword.map((value) => ({ type: 'plain' as const, value })),
    ...r.domain_regex.map((value) => ({ type: 'regex' as const, value })),
  ].filter((d) => d.value !== '');
  if (domains.length === 0) throw new GeoDatError('the rule-set has no domain rules, and the set is geosite', 0);
  return encodeGeoSiteList([{ code, domains }]);
}

// ---------------------------------------------------------------- MaxMind

const requireCjs = createRequire(import.meta.url);
type DecoderCtor = new (db: Buffer, baseOffset?: number) => { decodeFast(offset: number): { value: unknown } };
/** mmdb-lib reads one address at a time; walking every network needs its
 *  data decoder, which the package keeps out of its index. */
const Decoder: DecoderCtor = (requireCjs('mmdb-lib/lib/decoder.js') as { default: DecoderCtor }).default;

function recordReader(db: Buffer, recordSize: number): (node: number, right: boolean) => number {
  const size = recordSize / 4;
  switch (recordSize) {
    case 24:
      return (n, r) => db.readUIntBE(n * size + (r ? 3 : 0), 3);
    case 28:
      return (n, r) => {
        const o = n * size;
        return r ? ((db[o + 3]! & 0x0f) << 24) | db.readUIntBE(o + 4, 3) : ((db[o + 3]! & 0xf0) << 20) | db.readUIntBE(o, 3);
      };
    case 32:
      return (n, r) => db.readUInt32BE(n * size + (r ? 4 : 0));
    default:
      throw new GeoDatError(`record size ${recordSize} is not one MaxMind writes`, 0);
  }
}

/**
 * Every network of a MaxMind country database (GeoLite2-Country and alike)
 * by the country it names: `country.iso_code`, else `registered_country`. A
 * network naming neither is left out. In an IPv6 database the IPv4 space is
 * read where it lives, under ::/96, and the two aliases of it (::ffff:0:0/96
 * and 2002::/16) are not walked twice.
 */
export function mmdbCountries(bytes: Uint8Array): Map<string, GeoCidr[]> {
  const db = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let meta: { nodeCount: number; recordSize: number; ipVersion: number; searchTreeSize: number };
  try {
    meta = new Reader(db).metadata;
  } catch (err) {
    throw new GeoDatError(`not a readable MaxMind database: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const read = recordReader(db, meta.recordSize);
  const decoder = new Decoder(db, meta.searchTreeSize + 16);
  const bits = meta.ipVersion === 6 ? 128 : 32;
  const isoAt = new Map<number, string | null>();
  const out = new Map<string, GeoCidr[]>();

  const isoOf = (record: number): string | null => {
    if (isoAt.has(record)) return isoAt.get(record)!;
    let iso: string | null = null;
    try {
      const v = decoder.decodeFast(record - meta.nodeCount + meta.searchTreeSize).value as {
        country?: { iso_code?: string };
        registered_country?: { iso_code?: string };
      };
      iso = v?.country?.iso_code ?? v?.registered_country?.iso_code ?? null;
    } catch (err) {
      throw new GeoDatError(`a data record of the MaxMind database cannot be read: ${err instanceof Error ? err.message : String(err)}`, 0);
    }
    isoAt.set(record, iso);
    return iso;
  };

  const emit = (addr: Uint8Array, depth: number, record: number) => {
    const iso = isoOf(record);
    if (!iso) return;
    let ip = addr;
    let prefix = depth;
    if (bits === 128 && depth >= 96 && addr.subarray(0, 12).every((b) => b === 0)) {
      ip = addr.slice(12, 16);
      prefix = depth - 96;
    }
    const list = out.get(iso.toUpperCase()) ?? [];
    list.push({ ip: Uint8Array.from(ip), prefix });
    out.set(iso.toUpperCase(), list);
  };

  const isAlias = (addr: Uint8Array, depth: number) =>
    bits === 128 &&
    ((depth === 16 && addr[0] === 0x20 && addr[1] === 0x02) ||
      (depth === 96 && addr.subarray(0, 10).every((b) => b === 0) && addr[10] === 0xff && addr[11] === 0xff));

  const stack: { node: number; depth: number; addr: Uint8Array }[] = [{ node: 0, depth: 0, addr: new Uint8Array(bits / 8) }];
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth, addr } = stack.pop()!;
    if (++visited > meta.nodeCount * 2 + 1) throw new GeoDatError('the MaxMind search tree loops', 0);
    for (const right of [false, true]) {
      const next = new Uint8Array(addr);
      if (right) next[depth >> 3]! |= 0x80 >> (depth & 7);
      const record = read(node, right);
      const d = depth + 1;
      if (isAlias(next, d)) continue;
      if (record < meta.nodeCount) {
        if (d >= bits) throw new GeoDatError('the MaxMind search tree is deeper than an address', 0);
        stack.push({ node: record, depth: d, addr: next });
      } else if (record > meta.nodeCount) {
        emit(next, d, record);
      }
    }
  }
  return out;
}

/** A MaxMind country database as a geoip list, one tag per country (the iso
 *  code; tags read lower case, as every tag does). */
export function mmdbToDat(bytes: Uint8Array, kind: GeoSetKind): Uint8Array {
  if (kind !== 'geoip') throw new GeoDatError('this is a MaxMind database, which is a geoip list, and the set is geosite', 0);
  const countries = mmdbCountries(bytes);
  if (countries.size === 0) throw new GeoDatError('the MaxMind database names no country for any network', 0);
  return encodeGeoIPList(
    [...countries.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, cidrs]) => ({ code, cidrs })),
  );
}

/** Any accepted format as a v2fly `.dat` of the set's kind. */
export function toGeoDat(bytes: Uint8Array, kind: GeoSetKind, setName: string): { dat: Uint8Array; format: GeoSetFormat } {
  const format = detectGeoFormat(bytes);
  switch (format) {
    case 'rule-set-json':
      return { dat: ruleSetJsonToDat(bytes, kind, setName), format };
    case 'mmdb':
      return { dat: mmdbToDat(bytes, kind), format };
    default:
      return { dat: bytes, format };
  }
}
