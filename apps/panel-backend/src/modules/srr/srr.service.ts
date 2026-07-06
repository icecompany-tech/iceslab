import { prisma } from '../../prisma.js';

/**
 * User-Agent length cap before regex evaluation. This bounds the INPUT size but
 * NOT regex backtracking: V8's engine is backtracking, so a pathological admin
 * pattern like `(a+)+` can still blow up on a short crafted UA (30-40 chars is
 * enough). The real ReDoS guard is refusing catastrophic patterns at save time
 * (srr.schemas.ts); this cap just keeps well-formed linear patterns cheap.
 */
const UA_MAX_LENGTH = 256;

/**
 * In-process cache of the enabled rules, precompiled to RegExp. `/sub` without
 * `?format` hits this on every client poll, so we avoid a DB round-trip AND a
 * RegExp recompile per request (matching the bindings / settings caches on the
 * same hot path). Busted on any rule mutation (invalidateSrrCache) and by a
 * short TTL as a backstop.
 */
const SRR_CACHE_TTL_MS = 60_000;
interface CompiledRule {
  re: RegExp;
  format: string;
}
let srrCache: { rules: CompiledRule[]; expiresAt: number } | null = null;

/** Clear the SRR rule cache. Call after any rule create / update / delete. */
export function invalidateSrrCache(): void {
  srrCache = null;
}

async function getCompiledRules(): Promise<CompiledRule[]> {
  if (srrCache && Date.now() < srrCache.expiresAt) return srrCache.rules;
  const raw = await prisma.subscriptionResponseRule.findMany({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
    select: { uaPattern: true, format: true },
  });
  const rules: CompiledRule[] = [];
  for (const r of raw) {
    try {
      rules.push({ re: compileRule(r.uaPattern), format: r.format });
    } catch {
      // Bad regex, skip. The /srr admin UI is the place to surface it.
    }
  }
  srrCache = { rules, expiresAt: Date.now() + SRR_CACHE_TTL_MS };
  return rules;
}

/**
 * Walk enabled SRR rules in `priority ASC` order; return the first rule's
 * `format` whose `uaPattern` regex matches the (truncated) User-Agent.
 *
 * Returns null when there's no UA, no rules, or no rule matches, the route
 * handler then falls through to its existing Accept-header heuristic and
 * finally to `plain`. The compiled RegExps carry no `g` flag, so `.test` is
 * stateless and safe to reuse from the cache.
 */
export async function matchFormatForUserAgent(
  userAgent: string | null | undefined,
): Promise<string | null> {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, UA_MAX_LENGTH);
  for (const rule of await getCompiledRules()) {
    if (rule.re.test(ua)) {
      return rule.format;
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
