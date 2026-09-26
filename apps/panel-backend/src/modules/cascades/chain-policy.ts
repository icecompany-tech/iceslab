import { GEO_DIR_ON_NODE } from '@iceslab/shared';
import { chainRuleSetFileName, parseGeoRef } from '../geo-sets/geo-names.js';
import { splitPolicyEntries } from './policy-entries.js';
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
  /** E55: the address entries (geoip:, ext-ip:, CIDRs), their own rules. */
  blockIp?: ChainIpMatch;
  directIp?: ChainIpMatch;
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

// ───── E53: the node policy of an EXIT ─────
//
// A cascade's traffic leaves its exit from the chain process, not from the
// node's xray, so the node policy xray renders (warp, block, direct by domain,
// ip, port) never saw it: on the stand, domain:cloudflare.com -> warp on nl-01
// and cdn-cgi/trace through the cascade said warp=off. The exit's chain now
// carries the same rules, translated here, the way the entry carries A4.

/** IP matchers of one rule, the half sing-box ORs with the domain half. */
export interface ChainIpMatch {
  ip_cidr?: string[];
  rule_set?: string[];
}

function ipMatchOf(entries: string[], sets: Map<string, ChainRuleSetRef>): ChainIpMatch {
  const cidr: string[] = [];
  const ruleSet: string[] = [];
  for (const raw of entries) {
    const e = raw.trim();
    if (e === '') continue;
    const ref = parseGeoRef(e, 'ip');
    if (ref) {
      const setTag = ref.tag.toLowerCase();
      const file = chainRuleSetFileName(ref.set, setTag);
      const tag = `geo-${ref.set}-${setTag}`;
      if (!sets.has(tag)) sets.set(tag, { tag, file, path: `${GEO_DIR_ON_NODE}/${file}`, set: ref.set, setTag });
      ruleSet.push(tag);
      continue;
    }
    // A bare address is a /32 or /128 to sing-box as it is to xray.
    cidr.push(e.includes('/') ? e : e.includes(':') ? `${e}/128` : `${e}/32`);
  }
  const out: ChainIpMatch = {};
  if (cidr.length > 0) out.ip_cidr = [...new Set(cidr)];
  if (ruleSet.length > 0) out.rule_set = [...new Set(ruleSet)];
  return out;
}

/** xray's port string ("443", "1000-2000", "80,443") in sing-box's two fields. */
function portMatchOf(port: string | undefined): { port?: number[]; port_range?: string[] } {
  if (!port) return {};
  const ports: number[] = [];
  const ranges: string[] = [];
  for (const part of port.split(',')) {
    const p = part.trim();
    if (p === '') continue;
    const dash = p.indexOf('-');
    if (dash > 0) ranges.push(`${p.slice(0, dash).trim()}:${p.slice(dash + 1).trim()}`);
    else if (/^\d+$/.test(p)) ports.push(Number(p));
  }
  return { ...(ports.length > 0 ? { port: ports } : {}), ...(ranges.length > 0 ? { port_range: ranges } : {}) };
}

/** The outbound tag of the exit's WARP egress, as xray names its own. */
export const CHAIN_WARP_TAG = 'warp';

export interface ChainNodePolicyRule {
  match: {
    domain?: string[];
    ip?: string[];
    port?: string;
    protocol?: string[];
    network?: 'tcp' | 'udp' | 'tcp,udp';
  };
  action: { kind: 'direct' | 'block' | 'warp' | 'cascade' };
}

/**
 * A node policy as route rules of the exit's chain, in order, first match wins,
 * as in xray.
 *
 * Three differences with xray's engine, each handled here:
 *   - xray ANDs every field of a rule; sing-box ORs the domain matchers with
 *     the ip ones. A rule that names both becomes a logical `and` of the two.
 *   - xray's routing resolves a domain when no domain rule took it
 *     (`IPIfNonMatch`, the agent's render); sing-box matches IPs only on an IP
 *     destination. A `resolve` action goes in front of the first rule that
 *     matches by IP, after every rule before it had its chance by name.
 *   - a cascade rule has no meaning at an exit (it has no leg onwards), and the
 *     save already refuses one on a node that dials no such direction. Skipped.
 *
 * `usesWarp` says whether the rules route into WARP, so the caller can refuse
 * a node with no account rather than hand the engine a rule to a missing tag.
 */
export function chainNodePolicyOf(rules: ChainNodePolicyRule[]): {
  rules: Record<string, unknown>[];
  ruleSets: ChainRuleSetRef[];
  usesWarp: boolean;
} {
  const sets = new Map<string, ChainRuleSetRef>();
  const out: Record<string, unknown>[] = [];
  let resolved = false;
  let usesWarp = false;
  for (const r of rules) {
    if (r.action.kind === 'cascade') continue;
    const dom = matchOf(r.match.domain ?? [], sets);
    const ip = ipMatchOf(r.match.ip ?? [], sets);
    const rest: Record<string, unknown> = {
      ...portMatchOf(r.match.port),
      ...(r.match.protocol && r.match.protocol.length > 0 ? { protocol: r.match.protocol } : {}),
      ...(r.match.network && r.match.network !== 'tcp,udp' ? { network: [r.match.network] } : {}),
    };
    const action =
      r.action.kind === 'block'
        ? { action: 'reject', method: 'drop' }
        : { action: 'route', outbound: r.action.kind === 'warp' ? CHAIN_WARP_TAG : 'direct' };
    if (r.action.kind === 'warp') usesWarp = true;
    const hasDom = !chainMatchIsEmpty(dom);
    const hasIp = Object.keys(ip).length > 0;
    if (hasIp && !resolved) {
      out.push({ action: 'resolve' });
      resolved = true;
    }
    if (hasDom && hasIp) {
      out.push({ type: 'logical', mode: 'and', rules: [dom, { ...ip }, ...(Object.keys(rest).length > 0 ? [rest] : [])], ...action });
    } else if (!hasDom && !hasIp && Object.keys(rest).length === 0) {
      // A catch-all. sing-box takes no rule without a condition, so it is
      // spelled as the condition every connection meets.
      out.push({ network: ['tcp', 'udp'], ...action });
    } else {
      out.push({ ...dom, ...ip, ...rest, ...action });
    }
  }
  return { rules: out, ruleSets: [...sets.values()].sort((a, b) => a.tag.localeCompare(b.tag)), usesWarp };
}

/** The route policies of an entry, in ordinal order, and every rule-set they
 *  name, once. */
export function chainPoliciesOf(policies: CascadePolicy[]): {
  policies: ChainPolicy[];
  ruleSets: ChainRuleSetRef[];
} {
  const sets = new Map<string, ChainRuleSetRef>();
  // E55: names and addresses apart. The address half used to be dropped here.
  const ipOf = (entries: string[]): ChainIpMatch | undefined => {
    const m = ipMatchOf(splitPolicyEntries(entries).ip, sets);
    return Object.keys(m).length > 0 ? m : undefined;
  };
  const out = [...policies]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => {
      const blockIp = ipOf(p.blockDomains);
      const directIp = ipOf(p.directDomains);
      return {
        ordinal: p.ordinal,
        block: matchOf(splitPolicyEntries(p.blockDomains).domain, sets),
        direct: matchOf(splitPolicyEntries(p.directDomains).domain, sets),
        ...(blockIp ? { blockIp } : {}),
        ...(directIp ? { directIp } : {}),
      };
    });
  return { policies: out, ruleSets: [...sets.values()].sort((a, b) => a.tag.localeCompare(b.tag)) };
}
