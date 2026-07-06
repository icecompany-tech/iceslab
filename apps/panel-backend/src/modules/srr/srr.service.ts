import { prisma } from '../../prisma.js';

/**
 * Cap on User-Agent length before regex evaluation. Bounds runtime even when
 * an admin pastes a pathological pattern, together with the per-rule sandbox
 * (we just `RegExp.test` here, no eval), the worst case is O(N*M) where
 * N = UA_MAX_LENGTH and M = number of enabled rules. Both are tiny.
 */
const UA_MAX_LENGTH = 256;

/**
 * Walk enabled SRR rules in `priority ASC` order; return the first rule's
 * `format` whose `uaPattern` regex matches the (truncated) User-Agent.
 *
 * Returns null when there's no UA, no rules, or no rule matches, the route
 * handler then falls through to its existing Accept-header heuristic and
 * finally to `plain`.
 *
 * Invalid regex patterns are skipped silently. The /srr admin UI (slice 22
 * commit 4) is the place to surface "rule X has a bad pattern".
 */
export async function matchFormatForUserAgent(
  userAgent: string | null | undefined,
): Promise<string | null> {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, UA_MAX_LENGTH);

  const rules = await prisma.subscriptionResponseRule.findMany({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
    select: { uaPattern: true, format: true },
  });

  for (const rule of rules) {
    try {
      if (compileRule(rule.uaPattern).test(ua)) {
        return rule.format;
      }
    } catch {
      // Bad regex, skip. UI should let admin spot and fix it.
    }
  }
  return null;
}

/**
 * ECMAScript regex doesn't accept inline flag syntax like `(?i)foo`.
 * Operators expect to paste patterns from grep/PCRE/Python so we strip the
 * inline flag prefix and pass the flags through to RegExp's second arg.
 * Unknown / unsupported flags (like `x`/`u` extras) are silently dropped.
 */
function compileRule(pattern: string): RegExp {
  const m = pattern.match(/^\(\?([imsux]+)\)([\s\S]*)$/);
  if (m) {
    const flags = m[1]!.replace(/[^ims]/g, '');
    return new RegExp(m[2]!, flags);
  }
  return new RegExp(pattern);
}
