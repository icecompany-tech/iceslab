import type { RoutePolicy, RouteRule } from '@/lib/domain/routePolicies';
export interface DraftRule extends RouteRule {}

export const NEW_POLICY_ID = '__new__';

/** A blank policy for the New-policy button to open. */
export function blankPolicy(): RoutePolicy {
  return { id: NEW_POLICY_ID, name: '', ordinal: 0, rules: [], directDomains: [], blockDomains: [] };
}

/* ───── Model ───────────────────────────────────────────────────────────── */

/**
 * The policy as an ordered rule list. When the API ships `rules` that is what
 * we use; until then the two flat arrays are unrolled into one rule per domain,
 * block first, which is the order the config generator emits them in.
 */
export function toRules(policy: RoutePolicy, id: () => string): DraftRule[] {
  if (policy.rules) return policy.rules.map((r) => ({ ...r, id: r.id || id() }));
  return [
    ...policy.blockDomains.map((d) => ({ id: id(), match: [d], action: 'block' as const, note: '' })),
    ...policy.directDomains.map((d) => ({ id: id(), match: [d], action: 'direct' as const, note: '' })),
  ];
}

/** The payload shape, without the client-side keys. */
export function strip(rules: DraftRule[]) {
  return rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
}

/** Matchers are entered as one line, separated by spaces or middots. */
export function splitMatch(value: string): string[] {
  return value
    .split(/[\s·,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which rules can never fire, and because of what.
 *
 * Only exact matcher collisions are reported: an earlier rule claiming the same
 * token always wins, which is provable from the strings alone. Real subsumption
 * (geosite:google swallowing geosite:youtube) needs the geosite database, which
 * the panel does not have, so those go unflagged rather than guessed at.
 */
export function findShadows(rules: DraftRule[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const rule of rules) {
    if (rule.match.length === 0) continue;
    const hit = rule.match.find((m) => seen.has(m));
    if (hit !== undefined) {
      out.set(rule.id, hit);
      continue;
    }
    for (const m of rule.match) seen.set(m, rule.id);
  }
  return out;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */
