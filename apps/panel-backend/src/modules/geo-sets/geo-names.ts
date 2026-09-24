import { GEO_BUILTIN_NAMES } from '@iceslab/shared';

/**
 * How geo sets are spelled: in a rule, in a file name on a node, for xray and
 * for the chain. Pure, no database: the config renderers import it, and they
 * are pure themselves (geo-refs.ts is the half that reads the tables).
 */
/** The name the set's file has on a node (geo-contract.md section 1): the
 *  built-in ones under the names xray looks up, an operator's as
 *  `iceslab-<name>.dat`, which the agent's xray translates `ext:<name>:` to. */
export function nodeFileName(s: { name: string; sourceType: string }): string {
  return s.sourceType === 'builtin' ? `${s.name}.dat` : `iceslab-${s.name}.dat`;
}

/**
 * The chain's rule-set for one tag of one set (phase 9.3): a stable name per
 * (set, tag), so a new version of the set replaces the file under the same
 * name and the running chain reloads it without a restart (geo-contract.md
 * section 1). The tag keeps its `@attr`, lower case, as xray reads it.
 */
export function chainRuleSetFileName(set: string, tag: string): string {
  return `iceslab-${set}.${tag.toLowerCase()}.json`;
}

/**
 * An entry as xray on the node must spell it, for the JSON the PANEL renders
 * (the cascade fragments): `ext:<set>:<tag>` becomes `ext:iceslab-<set>.dat:
 * <tag>`, the file the set is laid out as. The agent does the same for the
 * policy and resolver it renders itself (internal/core/xray/geo.go); whoever
 * writes the core's JSON translates (geo-contract.md section 0). Everything
 * else, `geosite:` and `geoip:` included, passes through.
 */
export function xrayGeoEntry(entry: string): string {
  for (const prefix of ['ext:', 'ext-domain:', 'ext-ip:']) {
    if (!entry.startsWith(prefix)) continue;
    const rest = entry.slice(prefix.length);
    const cut = rest.indexOf(':');
    if (cut <= 0) return entry;
    const set = rest.slice(0, cut);
    if (set.endsWith('.dat')) return entry;
    return `${prefix}iceslab-${set}.dat${rest.slice(cut)}`;
  }
  return entry;
}

/** Which list of a rule an entry sits in: xray reads the two differently. */
export type GeoRefField = 'domain' | 'ip';

export interface GeoRef {
  /** The set's name: `geosite`, `geoip` or the `<name>` of `ext:`. */
  set: string;
  /** The tag as the rule spells it, attributes and `!` included. */
  tag: string;
  /** The tag the set has to contain: lower case, no `@attr`, no leading `!`. */
  baseTag: string;
  field: GeoRefField;
  entry: string;
}

/**
 * The geo reference in one rule entry, or null for an entry that names none
 * (a domain, a CIDR, `regexp:`, `keyword:`...). Spellings as xray takes them:
 * `geosite:`, `geoip:`, `ext:<file>:<tag>` and its qualified forms
 * `ext-domain:` and `ext-ip:` (infra/conf/router.go:370-402, 440-504).
 */
export function parseGeoRef(entry: string, field: GeoRefField): GeoRef | null {
  const e = entry.trim();
  let set: string;
  let tag: string;
  if (e.startsWith('geosite:')) {
    set = GEO_BUILTIN_NAMES.geosite;
    tag = e.slice('geosite:'.length);
  } else if (e.startsWith('geoip:')) {
    set = GEO_BUILTIN_NAMES.geoip;
    tag = e.slice('geoip:'.length);
  } else {
    const prefix = ['ext:', 'ext-domain:', 'ext-ip:'].find((p) => e.startsWith(p));
    if (!prefix) return null;
    const parts = e.slice(prefix.length).split(':');
    if (parts.length !== 2) return null;
    [set, tag] = parts as [string, string];
  }
  const baseTag = tag.replace(/^!/, '').split('@')[0]!.toLowerCase();
  if (set === '' || baseTag === '') return null;
  return { set, tag, baseTag, field, entry: e };
}
