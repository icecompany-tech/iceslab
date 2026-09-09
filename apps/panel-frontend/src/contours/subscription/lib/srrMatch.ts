import type { SrrRule, SubscriptionFormat } from '@/lib/domain/srr';

/**
 * The delivery matcher, run in the browser.
 *
 * This is a deliberate mirror of `srr.service.ts` on the backend: same order
 * (priority ascending), same skip of disabled rules and of patterns that do not
 * compile, same inline-flag handling, same User-Agent truncation. Both run on
 * V8, so the two agree.
 *
 * The panel needs it because `POST /api/srr/test` answers with the FORMAT only,
 * and the question an operator is actually asking is "which rule caught this",
 * which the endpoint cannot say. Matching here names the rule and lets the
 * create page answer the same question about a rule that does not exist yet.
 */

/** Matches the backend's UA_MAX_LENGTH. */
const UA_MAX_LENGTH = 256;

/**
 * ECMAScript has no inline flag syntax, but operators paste patterns from
 * grep / PCRE / Python, so `(?i)foo` is split into flags plus body exactly the
 * way the server's compileRule does. Unsupported flags are dropped.
 */
export function compilePattern(pattern: string): RegExp | null {
  const m = pattern.match(/^\(\?([imsux]+)\)([\s\S]*)$/);
  try {
    return m ? new RegExp(m[2]!, m[1]!.replace(/[^ims]/g, '')) : new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Does this pattern compile at all? The save would be refused otherwise. */
export function patternCompiles(pattern: string): boolean {
  return pattern.length > 0 && compilePattern(pattern) !== null;
}

export interface MatchResult {
  rule: SrrRule;
  format: SubscriptionFormat;
}

/** Every enabled rule matching this UA, in the order the endpoint walks them.
 *  The first is the winner; the rest are shadowed by it. */
export function matchingRules(rules: SrrRule[], userAgent: string): SrrRule[] {
  const ua = userAgent.slice(0, UA_MAX_LENGTH);
  return [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority)
    .filter((r) => {
      const re = compilePattern(r.uaPattern);
      return re !== null && re.test(ua);
    });
}

/** The rule the subscription endpoint would serve for this UA, or null when
 *  nothing matches and it falls back to its own default. */
export function matchRule(rules: SrrRule[], userAgent: string): MatchResult | null {
  const hit = matchingRules(rules, userAgent)[0];
  return hit ? { rule: hit, format: hit.format } : null;
}

/**
 * Which existing rule would beat a draft rule on this User-Agent. Returns null
 * when the draft wins, when it does not match the sample at all, or when there
 * is nothing to compare against.
 *
 * `excludeId` keeps a rule from shadowing itself while being edited.
 */
export function shadowedBy(
  rules: SrrRule[],
  draft: { uaPattern: string; priority: number; enabled: boolean },
  userAgent: string,
  excludeId?: string,
): SrrRule | null {
  if (!draft.enabled || !userAgent) return null;
  const re = compilePattern(draft.uaPattern);
  if (!re || !re.test(userAgent.slice(0, UA_MAX_LENGTH))) return null;
  const earlier = matchingRules(
    rules.filter((r) => r.id !== excludeId),
    userAgent,
  ).filter((r) => r.priority < draft.priority);
  return earlier[0] ?? null;
}
