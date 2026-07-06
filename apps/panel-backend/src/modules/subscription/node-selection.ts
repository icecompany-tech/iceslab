import { redis } from '../../lib/redis.js';
import { config } from '../../config.js';

/**
 * Slice 28: server-side smart node selection.
 *
 * Why this exists (and why it's deliberately small):
 *   Real deployments with 10+ regions want to hand each subscriber the
 *   ~3 best nodes (region match + load), not every node in the catalog.
 *   The full algorithm from the roadmap needs a GeoIP DB (MaxMind GeoLite2)
 *   to map client IP → country/region, which we haven't bundled yet.
 *
 *   What's shipped here:
 *     - `lookupClientCountry(ip)`: pluggable GeoIP backend with Redis cache
 *       (60s). Default backend reads `CF-IPCountry` header passed in by the
 *       Cloudflare front edge; when that's missing it returns null and the
 *       selection algo falls back to "all nodes" rather than guessing.
 *     - `rankNodesForUser(nodes, country, limit)`: pure function that scores
 *       eligible nodes by region match + utilization slot. Caller provides
 *       the eligible set so we never re-do squad/binding filtering here.
 *
 *   What's deferred (slice 28 follow-up):
 *     - MaxMind GeoLite2 bundling + monthly auto-update cron
 *     - `user.preferAllNodes: bool` opt-out flag (today: subscription
 *       handler can simply not call rankNodesForUser when admin wants the
 *       legacy "send everything" behaviour)
 *     - User-facing geo override (admin sets "force-route via EU" per user)
 */

export interface NodeForRanking {
  id: string;
  name: string;
  /** Region.code on the node row (`EU`, `RU`, `AS`, ...). null when the
   *  node hasn't been tagged with a region yet, these nodes still rank,
   *  just without the region-match bonus. */
  regionCode: string | null;
  /** Current active user count → divided by approximate capacity to derive
   *  a utilization score. Pass `null` when unknown (e.g. node just booted
   *  and stats haven't landed yet); the ranker treats null as zero load. */
  currentUsers?: number | null;
  /** Soft cap above which utilization score drops to zero. Optional:
   *  default 500 below; admins can tune per node when slice 28-follow-up
   *  lands the `maxUsers` column. */
  maxUsers?: number | null;
}

interface RankedNode<N> {
  node: N;
  score: number;
}

const DEFAULT_MAX_USERS = 500;

/**
 * Score:
 *   - region match adds 100 (dominant signal)
 *   - utilization adds 0..50 (lower load = higher score)
 *
 * Composable: drop-in additional signals later by widening the score
 * function, clients of `rankNodesForUser` only see the final ordering.
 */
function scoreNode(n: NodeForRanking, country: string | null): number {
  const regionScore = country && n.regionCode === country ? 100 : 0;
  const cap = n.maxUsers ?? DEFAULT_MAX_USERS;
  const used = n.currentUsers ?? 0;
  const utilization = Math.max(0, 1 - used / Math.max(cap, 1));
  return regionScore + utilization * 50;
}

export function rankNodesForUser<N extends NodeForRanking>(
  nodes: readonly N[],
  country: string | null,
  limit?: number,
): N[] {
  const ranked: RankedNode<N>[] = nodes.map((n) => ({ node: n, score: scoreNode(n, country) }));
  ranked.sort((a, b) => b.score - a.score);
  const sliced = typeof limit === 'number' && limit > 0 ? ranked.slice(0, limit) : ranked;
  return sliced.map((r) => r.node);
}

/**
 * Look up the country code for `ip`. Wraps a 60s Redis cache so repeat
 * subscription pulls from the same client don't hit the GeoIP backend
 * each time. Returns null when geography can't be determined; callers
 * MUST handle null as "skip region bonus, keep the user-eligible set
 * intact."
 *
 * Today the only backend is "trust CF-IPCountry"; future MaxMind
 * integration plugs in here behind the same signature.
 */
const GEOIP_CACHE_PREFIX = 'geoip:';
const GEOIP_CACHE_TTL_SEC = 60;

export interface ClientGeoSignals {
  /** `CF-IPCountry` header passed in from the front edge. Empty / `XX`
   *  treated same as missing, Cloudflare emits `XX` when the resolver
   *  fails. */
  cfCountry?: string;
}

export async function lookupClientCountry(
  ip: string,
  signals: ClientGeoSignals,
): Promise<string | null> {
  // Public flag, when admin disables smart selection by not configuring
  // any allowed countries, we still want the function to short-circuit
  // cleanly without hitting Redis. (config.ADMIN_ALLOWED_COUNTRIES being
  // non-empty is incidentally a good proxy for "Cloudflare front edge in
  // place"; if it's not, CF-IPCountry won't be reliable either.)
  void config; // referenced for future MaxMind toggle

  const cacheKey = `${GEOIP_CACHE_PREFIX}${ip}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === '_' ? null : cached;
  }

  const raw = signals.cfCountry?.trim().toUpperCase();
  const country = raw && raw !== 'XX' && /^[A-Z]{2}$/.test(raw) ? raw : null;

  await redis.set(cacheKey, country ?? '_', 'EX', GEOIP_CACHE_TTL_SEC);
  return country;
}
