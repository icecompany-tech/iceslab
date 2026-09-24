import { GEO_DIR_ON_NODE } from '@iceslab/shared';
import { chainRuleSetFileName, parseGeoRef } from '../geo-sets/geo-names.js';
import type { CascadePolicy } from './cascade.config.js';

/**
 * Route policies (A4) as the chain process at an ENTRY carries them out,
 * phase 9.3. Until now xray's entry drew them, gated on the client's UUID
 * variant; under handover the chain does, gated on the socks user the entry
 * hands the connection over as (`p<ordinal>`, chain.ports.ts). The entries
 * are xray matcher strings, stored that way since A4, and are translated here
 * into what sing-box matches on.
 */

/** Domain matchers of one sing-box rule. All of them OR together inside the
 *  rule, rule-sets included (sing-box merges a rule-set into the rule it is
 *  named in), and the `auth_user` beside them ANDs. */
export interface ChainMatch {
  domain?: string[];
  domain_suffix?: string[];
  domain_keyword?: string[];
  domain_regex?: string[];
  rule_set?: string[];
}

export interface ChainPolicy {
  ordinal: number;
  block: ChainMatch;
  direct: ChainMatch;
}

/** One rule-set the chain config names: its tag in the config, the file it
 *  reads, and the set and tag the file is built from. */
export interface ChainRuleSetRef {
  tag: string;
  path: string;
  file: string;
  set: string;
  setTag: string;
}

/**
 * One entry into matchers, the way xray reads the same string, and the way
 * SagerNet/sing-geosite converts a v2fly root domain:
 *   geosite:<tag>, ext:<set>:<tag>  a rule-set of that tag (file of the set)
 *   domain:x                        `x` itself and every name under it
 *   full:x                          `x` only
 *   keyword:x, regexp:x             keyword, regex
 *   bare x                          domain_suffix, as the chain always read it
 * `geoip:` and `ext-ip:` name addresses and mean nothing in a domain list.
 */
function addEntry(m: Required<ChainMatch>, sets: Map<string, ChainRuleSetRef>, entry: string): void {
  const e = entry.trim();
  if (e === '') return;
  const ref = parseGeoRef(e, 'domain');
  if (ref) {
    if (ref.set === 'geoip' || e.startsWith('ext-ip:')) return;
    const setTag = ref.tag.toLowerCase();
    const file = chainRuleSetFileName(ref.set, setTag);
    const tag = `geo-${ref.set}-${setTag}`;
    if (!sets.has(tag)) sets.set(tag, { tag, file, path: `${GEO_DIR_ON_NODE}/${file}`, set: ref.set, setTag });
    m.rule_set.push(tag);
    return;
  }
  if (e.startsWith('geoip:')) return;
  if (e.startsWith('domain:')) {
    const v = e.slice('domain:'.length);
    m.domain.push(v);
    m.domain_suffix.push(`.${v}`);
  } else if (e.startsWith('full:')) {
    m.domain.push(e.slice('full:'.length));
  } else if (e.startsWith('keyword:')) {
    m.domain_keyword.push(e.slice('keyword:'.length));
  } else if (e.startsWith('regexp:')) {
    m.domain_regex.push(e.slice('regexp:'.length));
  } else {
    m.domain_suffix.push(e);
  }
}

function matchOf(entries: string[], sets: Map<string, ChainRuleSetRef>): ChainMatch {
  const m: Required<ChainMatch> = { domain: [], domain_suffix: [], domain_keyword: [], domain_regex: [], rule_set: [] };
  for (const e of entries) addEntry(m, sets, e);
  const out: ChainMatch = {};
  for (const k of Object.keys(m) as (keyof ChainMatch)[]) {
    const v = [...new Set(m[k])];
    if (v.length > 0) out[k] = v;
  }
  return out;
}

export function chainMatchIsEmpty(m: ChainMatch): boolean {
  return Object.keys(m).length === 0;
}

/** The route policies of an entry, in ordinal order, and every rule-set they
 *  name, once. */
export function chainPoliciesOf(policies: CascadePolicy[]): {
  policies: ChainPolicy[];
  ruleSets: ChainRuleSetRef[];
} {
  const sets = new Map<string, ChainRuleSetRef>();
  const out = [...policies]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => ({
      ordinal: p.ordinal,
      block: matchOf(p.blockDomains, sets),
      direct: matchOf(p.directDomains, sets),
    }));
  return { policies: out, ruleSets: [...sets.values()].sort((a, b) => a.tag.localeCompare(b.tag)) };
}
