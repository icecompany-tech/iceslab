import type { GeoSetKind, GeoSetTag } from '@iceslab/shared';

/**
 * v2fly geo files (`geosite.dat`, `geoip.dat`) read by the panel itself: the
 * integrity check behind `verified`, the tag list, and the rule-set JSON the
 * chain gets for a tag. No protobuf dependency; the schema is four messages
 * (v2fly/v2ray-core app/router/routercommon/common.proto):
 *
 *   GeoSiteList { repeated GeoSite entry = 1 }
 *   GeoSite     { string country_code = 1; repeated Domain domain = 2 }
 *   Domain      { Type type = 1; string value = 2; repeated Attribute attribute = 3 }
 *               Type: Plain = 0, Regex = 1, RootDomain = 2, Full = 3
 *   Attribute   { string key = 1; oneof { bool bool_value = 2; int64 int_value = 3 } }
 *   GeoIPList   { repeated GeoIP entry = 1 }
 *   GeoIP       { string country_code = 1; repeated CIDR cidr = 2; bool reverse_match = 3 }
 *   CIDR        { bytes ip = 1; uint32 prefix = 2 }
 *
 * Why the panel and not `xray run -test`: xray does not read the file, it
 * scans it for one tag (infra/conf/router.go:243-301) and turns every read
 * error into "code not found", so a truncated file passes for any tag before
 * the cut (Ф9.0, 24.09). Here the whole file is walked, every field checked.
 *
 * ⚠ The top level carries no length, so a file cut exactly on an entry
 * boundary still parses, with fewer tags. Only the sha256 catches that.
 */

export class GeoDatError extends Error {
  constructor(
    message: string,
    /** Byte where reading stopped. */
    public readonly offset: number,
  ) {
    super(message);
    this.name = 'GeoDatError';
  }
}

/** One tag of a parsed file: where its entry lies, so a rule-set is built
 *  from that slice and the whole file is never held as objects. */
export interface GeoDatEntry {
  /** Lower case. */
  name: string;
  start: number;
  end: number;
  entries: number;
  /** geosite: attribute keys its domains carry that a rule can name, sorted. */
  attrs: string[];
}

export interface GeoDatIndex {
  kind: GeoSetKind;
  /** Only the tags xray can reach, first occurrence of each. */
  tags: GeoDatEntry[];
  /**
   * Codes present in the file that xray can never find, so they are not tags
   * here either: a code with lower-case letters (xray upper-cases the rule's
   * tag and compares bytes, router.go:188,349), a code that is not the entry's
   * first field (the scan reads it there, router.go:277-281), or a repeat of
   * an earlier code (the scan stops at the first). Offering them would make a
   * rule work in the chain and fail on the xray entry.
   */
  unreachable: string[];
}

// ---------------------------------------------------------------- reading

const utf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
  constructor(
    readonly buf: Uint8Array,
    public pos: number,
    readonly end: number,
  ) {}

  done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new GeoDatError('the file ends inside a number', this.pos);
      const b = this.buf[this.pos++]!;
      // Numbers here are tags, lengths, enum values and prefixes; anything
      // past 2^53 is not one of those, so precision loss above is moot.
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
    throw new GeoDatError('a number longer than ten bytes', this.pos);
  }

  key(): { field: number; wire: number; at: number } {
    const at = this.pos;
    const k = this.varint();
    const field = Math.floor(k / 8);
    if (field === 0) throw new GeoDatError('field number 0', at);
    return { field, wire: k % 8, at };
  }

  /** The bounds of a length-delimited value, checked against the parent. */
  bytes(): { start: number; end: number } {
    const at = this.pos;
    const len = this.varint();
    const start = this.pos;
    const end = start + len;
    if (end > this.end) {
      throw new GeoDatError(`a value of ${len} bytes runs past the end (${this.end - start} left)`, at);
    }
    this.pos = end;
    return { start, end };
  }

  string(what: string): string {
    const { start, end } = this.bytes();
    try {
      return utf8.decode(this.buf.subarray(start, end));
    } catch {
      throw new GeoDatError(`${what} is not valid UTF-8`, start);
    }
  }

  skip(wire: number, at: number): void {
    switch (wire) {
      case 0:
        this.varint();
        return;
      case 1:
        this.advance(8, at);
        return;
      case 2:
        this.bytes();
        return;
      case 5:
        this.advance(4, at);
        return;
      default:
        throw new GeoDatError(`wire type ${wire} is not one protobuf writes`, at);
    }
  }

  private advance(n: number, at: number): void {
    if (this.pos + n > this.end) throw new GeoDatError('the file ends inside a fixed-size value', at);
    this.pos += n;
  }
}

function expectWire(what: string, got: number, want: number, at: number): void {
  if (got !== want) throw new GeoDatError(`${what} has wire type ${got}, expected ${want}`, at);
}

// ---------------------------------------------------------------- parsing

interface RawEntry {
  code: string;
  codeFirst: boolean;
  start: number;
  end: number;
  entries: number;
  attrs: Set<string>;
}

/** Walks one GeoSite, checking every Domain. */
function readSite(r: Reader, into: RawEntry): void {
  let first = true;
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field === 1) {
      expectWire('the code of a geosite entry', wire, 2, at);
      into.code = r.string('the code of a geosite entry');
      into.codeFirst = first;
    } else if (field === 2) {
      expectWire('a domain', wire, 2, at);
      const { start, end } = r.bytes();
      readDomain(new Reader(r.buf, start, end), into.attrs);
      into.entries++;
    } else {
      r.skip(wire, at);
    }
    first = false;
  }
}

interface Domain {
  type: number;
  value: string;
  attrs: string[];
}

function readDomain(r: Reader, attrsSeen?: Set<string>): Domain {
  const d: Domain = { type: 0, value: '', attrs: [] };
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field === 1) {
      expectWire('the type of a domain', wire, 0, at);
      d.type = r.varint();
      if (d.type > 3) throw new GeoDatError(`domain type ${d.type} is none of plain, regex, domain, full`, at);
    } else if (field === 2) {
      expectWire('the value of a domain', wire, 2, at);
      d.value = r.string('the value of a domain');
    } else if (field === 3) {
      expectWire('an attribute', wire, 2, at);
      const { start, end } = r.bytes();
      const key = readAttribute(new Reader(r.buf, start, end));
      d.attrs.push(key);
      // xray lower-cases the rule's attribute and compares it to the stored
      // key byte for byte (router.go:311,338): a key with capitals is never
      // matched, so it is not offered.
      if (key === key.toLowerCase()) attrsSeen?.add(key);
    } else {
      r.skip(wire, at);
    }
  }
  if (d.value === '') throw new GeoDatError('a domain with no value', r.end);
  return d;
}

function readAttribute(r: Reader): string {
  let key = '';
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field === 1) {
      expectWire('the key of an attribute', wire, 2, at);
      key = r.string('the key of an attribute');
    } else {
      r.skip(wire, at);
    }
  }
  if (key === '') throw new GeoDatError('an attribute with no key', r.end);
  return key;
}

/** Walks one GeoIP, checking every CIDR. */
function readIP(r: Reader, into: RawEntry): void {
  let first = true;
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field === 1) {
      expectWire('the code of a geoip entry', wire, 2, at);
      into.code = r.string('the code of a geoip entry');
      into.codeFirst = first;
    } else if (field === 2) {
      expectWire('a CIDR', wire, 2, at);
      const { start, end } = r.bytes();
      readCidr(new Reader(r.buf, start, end));
      into.entries++;
    } else if (field === 3) {
      // reverse_match. Checked for shape only: xray drops it when it loads the
      // CIDRs (router.go:194-205 returns geoip.Cidr) and takes the reversal
      // from `!` in the rule alone.
      expectWire('reverse_match', wire, 0, at);
      r.varint();
    } else {
      r.skip(wire, at);
    }
    first = false;
  }
}

function readCidr(r: Reader): { ip: Uint8Array; prefix: number } {
  let ip: Uint8Array | null = null;
  let prefix = 0;
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field === 1) {
      expectWire('the address of a CIDR', wire, 2, at);
      const { start, end } = r.bytes();
      ip = r.buf.subarray(start, end);
      if (ip.length !== 4 && ip.length !== 16) {
        throw new GeoDatError(`an address of ${ip.length} bytes is neither IPv4 nor IPv6`, start);
      }
    } else if (field === 2) {
      expectWire('the prefix of a CIDR', wire, 0, at);
      prefix = r.varint();
    } else {
      r.skip(wire, at);
    }
  }
  if (!ip) throw new GeoDatError('a CIDR with no address', r.end);
  if (prefix > ip.length * 8) throw new GeoDatError(`prefix /${prefix} is longer than the address`, r.end);
  return { ip, prefix };
}

function walk(buf: Uint8Array, kind: GeoSetKind): RawEntry[] {
  const r = new Reader(buf, 0, buf.length);
  const out: RawEntry[] = [];
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field !== 1) {
      // Nothing else lives at the top of either list; a stray field here is a
      // file of another kind or not a geo file at all.
      throw new GeoDatError(`field ${field} at the top level, where only entries live`, at);
    }
    expectWire('an entry', wire, 2, at);
    const { start, end } = r.bytes();
    const e: RawEntry = { code: '', codeFirst: false, start, end, entries: 0, attrs: new Set() };
    const inner = new Reader(buf, start, end);
    if (kind === 'geosite') readSite(inner, e);
    else readIP(inner, e);
    if (e.code === '') throw new GeoDatError('an entry with no code', start);
    out.push(e);
  }
  if (out.length === 0) throw new GeoDatError('the file holds no entries', 0);
  return out;
}

const OTHER: Record<GeoSetKind, GeoSetKind> = { geosite: 'geoip', geoip: 'geosite' };

/**
 * Reads the whole file as `kind` and indexes its tags. Throws GeoDatError
 * with the words the set's `error` shows; a file of the other kind says so.
 */
export function parseGeoDat(buf: Uint8Array, kind: GeoSetKind): GeoDatIndex {
  let raw: RawEntry[];
  try {
    raw = walk(buf, kind);
  } catch (err) {
    if (!(err instanceof GeoDatError)) throw err;
    let other = false;
    try {
      walk(buf, OTHER[kind]);
      other = true;
    } catch {
      // Neither kind: the first error is the one to show.
    }
    if (other) {
      throw new GeoDatError(`this is a ${OTHER[kind]} file, the set is ${kind}`, err.offset);
    }
    throw new GeoDatError(`not a valid ${kind} file: ${err.message} (byte ${err.offset})`, err.offset);
  }

  const tags: GeoDatEntry[] = [];
  const unreachable: string[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const upper = e.code.toUpperCase();
    if (e.code !== upper || !e.codeFirst || seen.has(upper)) {
      unreachable.push(e.code);
      continue;
    }
    seen.add(upper);
    tags.push({
      name: e.code.toLowerCase(),
      start: e.start,
      end: e.end,
      entries: e.entries,
      attrs: [...e.attrs].sort(),
    });
  }
  return { kind, tags, unreachable };
}

export function geoTagList(index: GeoDatIndex): GeoSetTag[] {
  return index.tags.map((t) =>
    index.kind === 'geosite' ? { name: t.name, entries: t.entries, attrs: t.attrs } : { name: t.name, entries: t.entries },
  );
}

// ---------------------------------------------------------------- rule-sets

/** sing-box rule-set source, version 2 (what `geosite export` writes). */
export interface RuleSetJson {
  version: 2;
  rules: HeadlessRule[];
}

export interface HeadlessRule {
  domain?: string[];
  domain_suffix?: string[];
  domain_keyword?: string[];
  domain_regex?: string[];
  ip_cidr?: string[];
  invert?: boolean;
}

export class GeoTagUnknownError extends Error {
  constructor(public readonly tag: string) {
    super(`no tag "${tag}" in this file`);
    this.name = 'GeoTagUnknownError';
  }
}

function findTag(index: GeoDatIndex, name: string): GeoDatEntry {
  const t = index.tags.find((x) => x.name === name.toLowerCase());
  if (!t) throw new GeoTagUnknownError(name);
  return t;
}

/** An entry that filters to nothing matches nothing: `rules: []`. A rule with
 *  no conditions would be the opposite, so it is never written. */
function ruleSet(rule: HeadlessRule): RuleSetJson {
  const empty = !rule.domain && !rule.domain_suffix && !rule.domain_keyword && !rule.domain_regex && !rule.ip_cidr;
  return { version: 2, rules: empty ? [] : [rule] };
}

/**
 * The rule-set for `<tag>` or `<tag>@<attr>[@<attr>...]`, the way xray reads
 * the same rule (router.go:344-366: attributes lower-cased and AND-ed).
 *
 * Types map as SagerNet/sing-geosite converts them (main.go:106-133), which
 * is how the rest of the sing-box world reads a v2fly list:
 *   plain  -> domain_keyword
 *   regex  -> domain_regex
 *   domain -> domain (when the value has a dot) and domain_suffix ".value"
 *   full   -> domain
 * Their tag rewriting (filterTags, mergeTags at main.go:179-296) is NOT
 * repeated: xray has none, and one tag has to mean one list on both engines.
 *
 * Arrays are de-duplicated and sorted, so one tag of one file always gives
 * the same bytes and the same sha on the node.
 */
export function geositeRuleSet(buf: Uint8Array, index: GeoDatIndex, tag: string): RuleSetJson {
  if (index.kind !== 'geosite') throw new Error('geositeRuleSet on a geoip file');
  const [base, ...attrParts] = tag.split('@');
  const want = attrParts.map((a) => a.toLowerCase());
  const t = findTag(index, base!);

  const domain = new Set<string>();
  const suffix = new Set<string>();
  const keyword = new Set<string>();
  const regex = new Set<string>();
  const r = new Reader(buf, t.start, t.end);
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field !== 2) {
      r.skip(wire, at);
      continue;
    }
    const { start, end } = r.bytes();
    const d = readDomain(new Reader(buf, start, end));
    if (!want.every((a) => d.attrs.includes(a))) continue;
    switch (d.type) {
      case 0:
        keyword.add(d.value);
        break;
      case 1:
        regex.add(d.value);
        break;
      case 2:
        if (d.value.includes('.')) domain.add(d.value);
        suffix.add('.' + d.value);
        break;
      case 3:
        domain.add(d.value);
        break;
    }
  }
  const sorted = (s: Set<string>) => (s.size > 0 ? [...s].sort() : undefined);
  const rule: HeadlessRule = {};
  const a = sorted(domain);
  const b = sorted(suffix);
  const c = sorted(keyword);
  const e = sorted(regex);
  if (a) rule.domain = a;
  if (b) rule.domain_suffix = b;
  if (c) rule.domain_keyword = c;
  if (e) rule.domain_regex = e;
  return ruleSet(rule);
}

/**
 * The rule-set for a geoip `<tag>`, or `!<tag>` for its complement (xray's
 * `ext:file:!tag`, router.go:490-494). CIDRs keep file order, de-duplicated.
 */
export function geoipRuleSet(buf: Uint8Array, index: GeoDatIndex, tag: string): RuleSetJson {
  if (index.kind !== 'geoip') throw new Error('geoipRuleSet on a geosite file');
  const negated = tag.startsWith('!');
  const t = findTag(index, negated ? tag.slice(1) : tag);
  const cidrs = new Set<string>();
  const r = new Reader(buf, t.start, t.end);
  while (!r.done()) {
    const { field, wire, at } = r.key();
    if (field !== 2) {
      r.skip(wire, at);
      continue;
    }
    const { start, end } = r.bytes();
    const c = readCidr(new Reader(buf, start, end));
    cidrs.add(`${formatIp(c.ip)}/${c.prefix}`);
  }
  // The complement of nothing is every address, said without `invert` so the
  // rule is never one with no conditions.
  if (negated && cidrs.size === 0) return { version: 2, rules: [{ ip_cidr: ['0.0.0.0/0', '::/0'] }] };
  const rule: HeadlessRule = {};
  if (cidrs.size > 0) rule.ip_cidr = [...cidrs];
  if (negated) rule.invert = true;
  return ruleSet(rule);
}

/** Dotted quad, or RFC 5952 for IPv6 (longest run of two or more zero groups
 *  becomes "::", first on a tie; lower-case hex, no leading zeros). */
export function formatIp(ip: Uint8Array): string {
  if (ip.length === 4) return Array.from(ip).join('.');
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((ip[i]! << 8) | ip[i + 1]!);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (g: number[]) => g.map((x) => x.toString(16)).join(':');
  if (bestLen < 2) return hex(groups);
  return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLen))}`;
}
