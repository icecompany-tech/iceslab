import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { redis } from './redis.js';
import { notifyTelegramAsync, escapeMarkdown } from './telegram-notify.js';
import { honeypotHits, geoBlockDenials } from './metrics.js';
import { isPublicRoutableIp } from './ip.js';

/**
 * Tier-1 security gate. Two layers, both registered as a single
 * `onRequest` hook so they run before any route handler:
 *
 *   1. IP blacklist check, if `sec:blacklist:<ip>` exists in Redis,
 *      return 403 immediately. Set by the honeypot layer below.
 *
 *   2. Honey-route trap: well-known scanner paths (`/wp-admin`,
 *      `/.env`, `/xmlrpc.php`, etc) get a plausible 200 fake response
 *      AND drop the source IP into the blacklist for HONEYPOT_BLACKLIST_TTL_SEC.
 *      First-burst alert on Telegram if configured.
 *
 *   3. Geo-block: admin-only paths (`/api/*` minus public surfaces)
 *      require `CF-IPCountry` to be in ADMIN_ALLOWED_COUNTRIES. Fail
 *      closed: missing header on a gated path = 403. Skipped entirely
 *      when the allowlist is empty (the default).
 *
 * Order matters: blacklist before honey-route (so a scanner can't dodge
 * the blacklist by burning new endpoints), both before geo-block (so
 * we don't lose blacklist signal on a denied-country probe).
 *
 * Public surfaces NEVER hit geo-block:
 *   - `/sub/*`                 - subscription clients worldwide
 *   - `/api/internal/*`        - node agents (also worldwide)
 *   - `/api/auth/status`       - discovery used pre-login
 *   - `/health`, `/healthz`    - uptime checks
 *
 * Honeypot paths are exact-match for `/.env` and prefix-match for the
 * directory-style PHP/WP paths. Tight matching keeps false positives
 * near zero (the panel doesn't serve any of these legitimately).
 */
const HONEYPOT_EXACT = new Set<string>([
  '/.env',
  '/.git/config',
  '/.aws/credentials',
  '/wp-config.php',
  '/xmlrpc.php',
  '/phpinfo.php',
  '/server-status',
]);
const HONEYPOT_PREFIXES = ['/wp-admin', '/wp-login', '/wordpress', '/phpmyadmin', '/.git/'];

const PUBLIC_PATH_PREFIXES = ['/sub/', '/api/internal/', '/health', '/healthz'];
const PUBLIC_PATH_EXACT = new Set<string>(['/api/auth/status']);

function isPublicPath(url: string): boolean {
  if (PUBLIC_PATH_EXACT.has(url)) return true;
  for (const p of PUBLIC_PATH_PREFIXES) {
    if (url.startsWith(p)) return true;
  }
  return false;
}

function isHoneypotPath(url: string): boolean {
  // Strip query string before matching, `/.env?x=1` is still a probe.
  // Lowercase the path before matching: scanners regularly probe with
  // mixed/upper casing (`/Wp-Admin`, `/.GIT/config`) and Linux file
  // systems are case-sensitive but our trap is a pure pattern match,
  // not a real filesystem lookup. Matching case-insensitively closes
  // the trivial bypass.
  const raw = url.split('?', 1)[0] ?? url;
  const path = raw.toLowerCase();
  if (HONEYPOT_EXACT.has(path)) return true;
  for (const p of HONEYPOT_PREFIXES) {
    if (path.startsWith(p)) return true;
  }
  return false;
}

const BLACKLIST_KEY = (ip: string): string => `sec:blacklist:${ip}`;

// B8 - in-process cache over the blacklist lookup. The prior code hit Redis
// (EXISTS) on EVERY request, even though the overwhelming majority come from
// non-blacklisted IPs (and a polling subscription client or admin tab hammers
// the same IP). Cache the answer: positives for the full blacklist TTL (they
// won't flip to false until expiry), negatives only briefly so a blacklist set
// by another path is still picked up fast. When THIS process blacklists an IP
// we update the cache positively right away. Bounded LRU-ish (oldest-evict on
// overflow) so a flood of distinct IPs can't grow it unbounded.
const NEG_CACHE_TTL_MS = 5_000;
const BLACKLIST_CACHE_MAX = 10_000;
const blacklistCache = new Map<string, { hit: boolean; expiresAt: number }>();

function cacheGet(ip: string): boolean | null {
  const e = blacklistCache.get(ip);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    blacklistCache.delete(ip);
    return null;
  }
  return e.hit;
}

function cacheSet(ip: string, hit: boolean, ttlMs: number): void {
  if (blacklistCache.size >= BLACKLIST_CACHE_MAX) {
    const oldest = blacklistCache.keys().next().value;
    if (oldest !== undefined) blacklistCache.delete(oldest);
  }
  blacklistCache.set(ip, { hit, expiresAt: Date.now() + ttlMs });
}

async function isBlacklisted(ip: string): Promise<boolean> {
  const cached = cacheGet(ip);
  if (cached !== null) return cached;
  const hit = (await redis.exists(BLACKLIST_KEY(ip))) === 1;
  cacheSet(ip, hit, hit ? config.HONEYPOT_BLACKLIST_TTL_SEC * 1000 : NEG_CACHE_TTL_MS);
  return hit;
}

async function blacklist(ip: string): Promise<boolean> {
  // SET NX so we can detect the "first hit", that's the one we alert on.
  // Returns 'OK' on insert, null when key already exists.
  const ok = await redis.set(
    BLACKLIST_KEY(ip),
    '1',
    'EX',
    config.HONEYPOT_BLACKLIST_TTL_SEC,
    'NX',
  );
  // B8 - reflect the entry locally so the very next request from this IP is
  // blocked without waiting for its negative cache entry to expire.
  cacheSet(ip, true, config.HONEYPOT_BLACKLIST_TTL_SEC * 1000);
  return ok === 'OK';
}

export async function registerSecurityGate(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const ip = request.ip;
    const url = request.url;

    // Layer 1: blacklist short-circuit.
    if (await isBlacklisted(ip)) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    // Layer 2: honeypot.
    if (isHoneypotPath(url)) {
      honeypotHits.inc();
      // Only blacklist a genuinely public, routable source. A misconfigured
      // TRUST_PROXY_HOPS lets a client forge X-Forwarded-For with a private /
      // loopback IP (or a victim's IP); blacklisting a non-routable one would
      // punish whoever really sits behind that CGNAT/private range. We still
      // serve the plausible fake 404 for EVERY hit (below) so a spoofing scanner
      // learns nothing from the difference. Mirrors the honey-token guard in
      // subscription.routes.ts. (A forged *public* IP still needs a correct
      // TRUST_PROXY_HOPS to be neutralised, see config.ts.)
      if (isPublicRoutableIp(ip)) {
        const firstHit = await blacklist(ip);
        if (firstHit) {
          notifyTelegramAsync(
            `🪤 *Honeypot triggered*\nip: \`${escapeMarkdown(ip)}\`\npath: \`${escapeMarkdown(url)}\`\nblacklisted for ${config.HONEYPOT_BLACKLIST_TTL_SEC}s`,
          );
        }
      }
      // Plausible-but-empty fake. Static body so scanners that fingerprint
      // by content length see a real-looking 404 rather than the 403 they'd
      // use as a "this server is hardened, move on" signal.
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.code(404).send(
        '<html><head><title>Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>',
      );
    }

    // Layer 3: geo-block on gated (admin) paths.
    //
    // ⚠ Trust model: `CF-IPCountry` is only trustworthy when Cloudflare
    // owns the public edge AND the backend is reachable only through CF
    // (orange-cloud + IP allowlist from CF ranges, or terminated by Caddy
    // upstream of which CF is the only allowed upstream). Without that,
    // anyone can spoof `CF-IPCountry: RU` and walk through. Enforce CF
    // orange-cloud at the network layer; this hook only does the policy
    // check. The fallback `X-Country-Code` header is for non-CF
    // deployments behind their own edge (Caddy/Nginx that strips/sets it).
    if (config.ADMIN_ALLOWED_COUNTRIES.length === 0) return;
    if (isPublicPath(url)) return;
    // The geo-block only applies to /api/* routes (the SPA shell + assets
    // are served by the frontend container and never hit this backend).
    if (!url.startsWith('/api/')) return;

    const raw = (request.headers['cf-ipcountry'] ??
      request.headers['x-country-code']) as string | string[] | undefined;
    const country = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase();
    if (!country || !/^[A-Z]{2}$/.test(country) || !config.ADMIN_ALLOWED_COUNTRIES.includes(country)) {
      geoBlockDenials.inc();
      return reply.code(403).send({ error: 'GEO_BLOCKED' });
    }
  });
}
