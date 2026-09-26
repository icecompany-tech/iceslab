import { isIP } from 'node:net';
import { parseGeoRef } from '../geo-sets/geo-names.js';

/**
 * E55: what one entry of a route policy matches on, a NAME or an ADDRESS.
 *
 * The lists are called "domains" and were read as domains everywhere: the
 * chain's translation dropped `geoip:` and `ext-ip:` without a word
 * (chain-policy.ts addEntry), and xray got them in its `domain` field, where
 * they are a substring nobody's hostname contains. The form took them. So the
 * acceptance criterion of Э3, written with `geoip` ("ru goes direct by
 * address" on an AWG entry), could be saved and did nothing.
 *
 * Each entry is now one of the two, or refused at the save:
 *   name     geosite:, ext:, ext-domain:, domain:, full:, keyword:, regexp:,
 *            a bare hostname;
 *   address  geoip:, ext-ip:, an IPv4/IPv6 address, a CIDR.
 */
export type PolicyEntryKind = 'domain' | 'ip';

const HOSTNAME = /^[A-Za-z0-9_*]([A-Za-z0-9_*.-]*[A-Za-z0-9_])?$/;

function isCidr(e: string): boolean {
  const cut = e.indexOf('/');
  if (cut <= 0) return false;
  const addr = e.slice(0, cut);
  const bits = e.slice(cut + 1);
  const family = isIP(addr);
  if (family === 0 || !/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

export function classifyPolicyEntry(raw: string): PolicyEntryKind | null {
  const e = raw.trim();
  if (e === '') return null;
  if (e.startsWith('geoip:') || e.startsWith('ext-ip:')) return parseGeoRef(e, 'ip') ? 'ip' : null;
  if (e.startsWith('geosite:') || e.startsWith('ext:') || e.startsWith('ext-domain:')) {
    return parseGeoRef(e, 'domain') ? 'domain' : null;
  }
  for (const prefix of ['domain:', 'full:', 'keyword:']) {
    if (e.startsWith(prefix)) return /^\S+$/.test(e.slice(prefix.length)) ? 'domain' : null;
  }
  if (e.startsWith('regexp:')) {
    try {
      new RegExp(e.slice('regexp:'.length));
      return e.length > 'regexp:'.length ? 'domain' : null;
    } catch {
      return null;
    }
  }
  if (isIP(e) !== 0 || isCidr(e)) return 'ip';
  return HOSTNAME.test(e) ? 'domain' : null;
}

/** The entries by kind, each in its order. Unknown ones are left out: the save
 *  refuses them, so one here is a row written before this check. */
export function splitPolicyEntries(entries: readonly string[]): { domain: string[]; ip: string[] } {
  const out = { domain: [] as string[], ip: [] as string[] };
  for (const e of entries) {
    const kind = classifyPolicyEntry(e);
    if (kind) out[kind].push(e.trim());
  }
  return out;
}
