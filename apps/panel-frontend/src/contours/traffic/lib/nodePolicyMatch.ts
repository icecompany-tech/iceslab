import type { PolicyMatch } from '@/lib/domain/nodePolicies';

/**
 * A rule's matchers, between the two shapes they live in.
 *
 * The API keeps domains and addresses in separate arrays, because the node
 * translates them into different matcher families. The operator writes one
 * line, the way the rule reads out loud: `geosite:ru · geoip:private`. So the
 * screen joins for display and sorts on the way back in, and the sorting rule
 * is the same one the node uses, not a guess about what the text means.
 */

const IP_PREFIXES = ['geoip:', 'ip:', 'cidr:'];

/** An address-shaped token: a geoip set, a CIDR, or a bare v4/v6 literal.
 *  Everything else is a domain matcher, including bare hostnames. */
export function isAddressToken(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (IP_PREFIXES.some((p) => t.startsWith(p))) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(t)) return true;
  // A colon plus hex only: an v6 literal. `geosite:x` and `domain:x` carry
  // letters after the colon and are caught by the check above them.
  return /^[0-9a-f:]+(\/\d{1,3})?$/.test(t) && t.includes(':');
}

/** The matchers of a rule as one readable line, in the order they were typed. */
export function matchTokens(match: PolicyMatch): string[] {
  return [...match.domain, ...match.ip];
}

/**
 * The operator's line back into the two arrays.
 *
 * Splits on comma and on the middle dot the display uses, so a line copied off
 * the screen and edited goes back in unchanged. Whitespace alone is NOT a
 * separator: a matcher never contains a space, but a half-typed one might.
 */
export function parseTokens(line: string, base: PolicyMatch): PolicyMatch {
  const tokens = line
    .split(/[,·\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ...base,
    domain: tokens.filter((t) => !isAddressToken(t)),
    ip: tokens.filter(isAddressToken),
  };
}

/**
 * Everything the match says beyond its domain and address lists.
 *
 * These have no column of their own on the artboard, and they change what the
 * rule catches, so they ride in the note lane rather than being invisible.
 *
 * Returned as matcher tokens, not prose: `port:25` reads the same in both
 * locales and matches how the rest of the line is written.
 */
export function extraMatchers(match: PolicyMatch): string[] {
  const out: string[] = [];
  if (match.port) out.push(`port:${match.port}`);
  if (match.network) out.push(match.network);
  if (match.protocol.length > 0) out.push(match.protocol.join('/'));
  return out;
}
