import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import * as service from './subscription.service.js';
import { buildClashYaml } from './formats/clash.js';
import { buildSingboxJson } from './formats/singbox.js';
import { buildWgQuickConf } from './formats/wgconf.js';
import { buildXrayJson } from './formats/xrayjson.js';
import { buildSubscriptionPage } from './formats/page.js';
import { matchFormatForUserAgent } from '../srr/srr.service.js';
import {
  formatBytes,
  getSubscriptionSettings,
  renderAnnounce,
} from '../settings/settings.service.js';
import { enforceHwid } from '../hwid/hwid.service.js';
import { prisma } from '../../prisma.js';
import { config } from '../../config.js';
import { subscriptionRequests } from '../../lib/metrics.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';
import { redis } from '../../lib/redis.js';

const TokenParamSchema = z.object({
  token: z.string().min(8).max(128),
});

const FormatEnum = z.enum(['plain', 'json', 'clash', 'singbox', 'wgconf', 'xrayjson']);
type Format = z.infer<typeof FormatEnum>;

const QuerySchema = z.object({
  format: FormatEnum.optional(),
  // Slice 29 — outbound group flavour. Per-format semantics:
  //   sing-box   : 'selector' (default) | 'url-test'   (auto-failover)
  //   xray-json  : 'flat'     (default) | 'balancer'   (observatory+leastPing)
  //   clash      : already always emits url-test in its proxy-groups
  // We share one query param across formats because admins picking the
  // "smart auto-failover" form usually want it everywhere their clients
  // see it, not per-format.
  bundle: z.enum(['selector', 'url-test', 'flat', 'balancer']).optional(),
  // Slice 28 — when set, cap subscription to top-N nodes ranked by region
  // match (CF-IPCountry) + current utilization. Default (omitted) keeps
  // legacy "return everything" behaviour so existing clients don't regress.
  // Capped at 32 to avoid pathological "give me 9999" requests.
  topN: z.coerce.number().int().min(1).max(32).optional(),
});

const FORMAT_VALUES: ReadonlySet<Format> = new Set(FormatEnum.options);

function isFormat(value: string): value is Format {
  return FORMAT_VALUES.has(value as Format);
}

// isPublicRoutableIp returns true only for IPv4/IPv6 addresses safe to use as
// a blacklist key. Filters out loopback, RFC1918 private, link-local, and
// unspecified. The honeypot blacklist sticks for HONEYPOT_BLACKLIST_TTL_SEC,
// so a bad key (e.g. spoofed 10.x.x.x) would DoS legit clients sharing that
// CGNAT range — so we refuse to blacklist anything non-routable.
function isPublicRoutableIp(ip: string): boolean {
  if (!ip) return false;
  const v = isIP(ip);
  if (v === 0) return false;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) — recurse into the v4 side so the
  // private-range guards below catch ::ffff:10.0.0.1 / ::ffff:127.0.0.1.
  // Otherwise an attacker spoofing X-Forwarded-For: ::ffff:10.0.0.1
  // would pass isIP===6 and the v6 branch's loose-prefix checks miss it.
  if (v === 6 && /^::ffff:/i.test(ip)) {
    return isPublicRoutableIp(ip.replace(/^::ffff:/i, ''));
  }
  if (v === 4) {
    const parts = ip.split('.').map((s) => parseInt(s, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
    // 100.64.0.0/10 — CGNAT. Not strictly "private" but operators sharing
    // a carrier-NAT range shouldn't be blacklisted by us either.
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  // IPv6 (non-mapped).
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  // Multicast (ff00::/8), documentation (2001:db8::/32).
  if (lower.startsWith('ff')) return false;
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return false;
  return true;
}

/**
 * Resolve which format the client wants, in this priority order:
 *   1. Explicit `?format=` always wins.
 *   2. SRR (Subscription Response Rules) — UA regex match against admin-
 *      defined rules in DB. Default seed rules cover Hiddify/Clash/v2rayN/
 *      sing-box/AmneziaWG-app + a `.*` catch-all → `plain`.
 *   3. Legacy Accept-header heuristic (`application/json` → `json`) for the
 *      IcePath-VPN bot integration that predates SRR.
 *   4. `plain` fallback (base64 URI list — universal).
 */
/**
 * Slice S1 — set the subscription-metadata HTTP headers most VPN clients
 * read alongside the body. Conventions across Hiddify/V2RayNG/Streisand/
 * Happ/Mihomo:
 *
 *   Profile-Title              — display name in the client's profile list
 *   Profile-Update-Interval    — refresh cadence in HOURS (clients re-fetch
 *                                without admin intervention)
 *   Subscription-Userinfo      — `upload=N; download=N; total=N; expire=T`
 *                                (RFC-3339-ish), drives the quota gauge
 *   Support-URL                — clickable link in the profile detail page
 *   Announce                   — short banner shown to the user (rendered
 *                                template, supports {{TRAFFIC_LEFT}} etc.)
 *
 * Only well-formed values are emitted — admins can leave any setting NULL
 * to omit the corresponding header.
 */
async function applySubscriptionHeaders(
  reply: FastifyReply,
  user: {
    expireAt: string | null;
    trafficLimitBytes: number | null;
    trafficUsedBytes: number;
  },
): Promise<void> {
  const settings = await getSubscriptionSettings();

  const title = settings.profileTitle ?? settings.brandName;
  if (title) reply.header('Profile-Title', `base64:${Buffer.from(title, 'utf8').toString('base64')}`);
  reply.header('Profile-Update-Interval', String(settings.updateIntervalHours));
  if (settings.supportUrl) reply.header('Support-URL', settings.supportUrl);

  // Subscription-Userinfo. `upload+download === used`. We don't track
  // upload separately yet (per-user xray stats sum both directions),
  // so attribute everything to `download` and report `upload=0` — clients
  // sum them to derive used quota and the gauge stays correct.
  const used = Math.max(0, user.trafficUsedBytes);
  const total = user.trafficLimitBytes ?? 0;
  // expire is unix seconds; 0 = no expiry per de-facto convention.
  const expireUnix = user.expireAt
    ? Math.floor(new Date(user.expireAt).getTime() / 1000)
    : 0;
  reply.header(
    'Subscription-Userinfo',
    `upload=0; download=${used}; total=${total}; expire=${expireUnix}`,
  );

  // Announce — rendered template. Skip emission if template empty.
  if (settings.announceTemplate) {
    const trafficLeft =
      user.trafficLimitBytes === null
        ? '∞'
        : formatBytes(BigInt(Math.max(0, user.trafficLimitBytes - used)));
    const daysLeft =
      user.expireAt === null
        ? '∞'
        : String(
            Math.max(
              0,
              Math.ceil(
                (new Date(user.expireAt).getTime() - Date.now()) /
                  86400_000,
              ),
            ),
          );
    const announce = renderAnnounce(settings.announceTemplate, {
      trafficLeft,
      daysLeft,
      supportUrl: settings.supportUrl ?? '',
    });
    if (announce.length > 0) {
      // Some clients require base64 encoding for non-ASCII announce. We
      // emit both forms — Happ reads `Announce-URL`-style raw, Hiddify
      // base64. Stick with `Announce: base64:<...>` which both accept.
      reply.header(
        'Announce',
        `base64:${Buffer.from(announce, 'utf8').toString('base64')}`,
      );
    }
  }
}

async function resolveFormat(
  query: z.infer<typeof QuerySchema>,
  acceptHeader: string,
  userAgent: string | null,
): Promise<Format> {
  if (query.format) return query.format;
  const matched = await matchFormatForUserAgent(userAgent);
  if (matched && isFormat(matched)) return matched;
  if (acceptHeader.toLowerCase().includes('application/json')) return 'json';
  return 'plain';
}

// Wave-14 #6: a browser navigating to /sub/<token> should see a human page,
// not a base64 dump. Trigger on Accept: text/html with no explicit ?format —
// VPN clients send their own UA/Accept and never hit this. An explicit
// ?format= always wins (so `?format=plain` in a browser still returns raw).
function wantsHtmlPage(
  query: z.infer<typeof QuerySchema>,
  acceptHeader: string,
): boolean {
  if (query.format) return false;
  return acceptHeader.toLowerCase().includes('text/html');
}

function pickLang(acceptLanguage: string | undefined): 'ru' | 'en' {
  return (acceptLanguage ?? '').toLowerCase().includes('ru') ? 'ru' : 'en';
}

// Strip characters Content-Disposition can't legally carry to keep
// browsers happy across OSes. Username comes from admin-controlled
// input so paranoia is cheap; whitelist [a-zA-Z0-9._-], fold rest to
// underscore, cap length to keep filesystem-safe.
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return cleaned || 'subscription';
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // Secondary IP-only ceiling. The route's primary rate-limit is keyed on
  // (ip, token) — legit, but an attacker rotates tokens to dodge it. This
  // hook caps total /sub hits per IP via a sliding Redis bucket, well
  // above legit shared-CGNAT polling so real users never feel it.
  async function ipRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ip = request.ip;
    const key = `sec:sub-ip:${ip}`;
    // Atomic INCR + (set TTL if first). Prior version did INCR then EXPIRE
    // in two round-trips — if the process crashed between them, the key
    // would live forever (until Redis maxmemory-policy evicted it). The
    // SET-NX-EX-1 below ensures TTL is established the moment the key
    // becomes non-empty, and ignored otherwise (NX). INCR then reads/bumps.
    await redis.set(key, '0', 'EX', 60, 'NX').catch(() => null);
    const count = await redis.incr(key).catch(() => 0);
    if (count > config.RATE_LIMIT_SUB_IP_PER_MIN) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({
        error: 'RATE_LIMIT',
        message: 'Too many requests from this IP',
      });
    }
  }

  // GET /sub/:token — public (the token IS the credential).
  // Two-bucket rate-limit:
  //   - per-(ip,token) bucket caps a legit client's polling rate
  //   - per-(ip) bucket via ipRateLimitHook catches token-rotation
  // Path prefix is admin-configurable via SUBSCRIPTION_PATH_PREFIX env
  // (default `/sub`). Lets operators mask Iceslab signature on the
  // wire — e.g. `/v` so user links look like https://panel/v/<token>.
  app.get(`${config.SUBSCRIPTION_PATH_PREFIX}/:token`, {
    onRequest: [ipRateLimitHook],
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_SUB_PER_MIN,
        timeWindow: '1 minute',
        // Per-token bucket so one client polling on the same token doesn't
        // share rate-budget with unrelated subscriptions on shared CGNAT.
        keyGenerator: (req) => {
          const t = (req.params as { token?: string })?.token ?? 'unknown';
          return `${req.ip}:${t}`;
        },
      },
    },
  }, async (request, reply) => {
    const params = TokenParamSchema.parse(request.params);
    const query = QuerySchema.parse(request.query);
    const userAgent = typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null;
    const format = await resolveFormat(
      query,
      (request.headers.accept ?? '').toString(),
      userAgent,
    );
    subscriptionRequests.inc({ format });

    // Tier-1 honey-user tripwire. If the requested token is on the admin's
    // canary list, the token by definition was leaked from where it was
    // planted (pastebin, screenshot, dropped USB, …). Alert immediately,
    // blacklist the source IP (same Redis key as the path-honeypot), and
    // return a plausible-empty 200 — making the attacker believe their
    // exfiltrated token is "just empty subscription" instead of "this is
    // a panel that knows it was leaked."
    if (config.HONEY_USER_TOKENS.includes(params.token)) {
      const ip = request.ip;
      const ttl = config.HONEYPOT_BLACKLIST_TTL_SEC;
      // Only blacklist real public IPs. If TRUST_PROXY_HOPS is misconfigured
      // an attacker can spoof X-Forwarded-For with a private/loopback IP and
      // get arbitrary legit users DoS'd via this honeypot. Skip the blacklist
      // for any IP we can identify as non-routable; still alert + return empty.
      if (isPublicRoutableIp(ip)) {
        await redis.set(`sec:blacklist:${ip}`, '1', 'EX', ttl, 'NX').catch(() => null);
      }
      notifyTelegramAsync(
        `🪤 *Honey-user token used*\nip: \`${escapeMarkdown(ip)}\`\nua: \`${escapeMarkdown(userAgent ?? '?')}\`\nformat: \`${format}\`\ntoken: \`${escapeMarkdown(params.token.slice(0, 6))}...\``,
      );
      // Plausible empty subscription. Mirror the same content-type the
      // legit path would use for `?format=plain`.
      reply.type('text/plain; charset=utf-8');
      return reply.send('');
    }

    try {
      // Slice S2 — HWID enforcement runs BEFORE generateSubscription so
      // a denied client doesn't burn a subscription_request_history row
      // or stress the binding query. Cost is one cheap user lookup.
      const hwidHeader = request.headers['x-hwid'];
      const hwid =
        typeof hwidHeader === 'string' && hwidHeader.length > 0 && hwidHeader.length <= 255
          ? hwidHeader
          : null;
      const userMin = await prisma.user.findFirst({
        where: { subscriptionToken: params.token, deletedAt: null },
        select: { id: true, hwidDeviceLimit: true },
      });
      if (userMin) {
        const hwidResult = await enforceHwid(
          userMin.id,
          hwid,
          userMin.hwidDeviceLimit,
        );
        // Always emit the gauge header so the client can render "2/3" in
        // its profile detail UI — even on success, even when no limit set.
        // HTTP headers are ISO-8859-1; use ASCII-only "unlimited" instead
        // of '∞' which throws on the wire.
        if (hwidResult.limit !== null) {
          reply.header(
            'X-Hwid-Active',
            `${hwidResult.active}/${hwidResult.limit}`,
          );
        } else {
          reply.header(
            'X-Hwid-Active',
            `${hwidResult.active}/unlimited`,
          );
        }
        if (hwidResult.status === 'denied') {
          // 403 with a structured body — clients that don't read headers
          // still get a parseable reason.
          return reply.code(403).send({
            error: 'HWID_LIMIT',
            message: `Device limit reached (${hwidResult.active}/${hwidResult.limit})`,
            active: hwidResult.active,
            limit: hwidResult.limit,
          });
        }
      }

      // CF-IPCountry forwarded into the service so the smart-selection
      // ranker (slice 28) can score nodes by region match. Falls back to
      // `X-Country-Code` for non-Cloudflare deployments where the edge
      // sets its own header.
      const cfCountryRaw = (request.headers['cf-ipcountry'] ??
        request.headers['x-country-code']) as string | string[] | undefined;
      const cfCountry = Array.isArray(cfCountryRaw) ? cfCountryRaw[0] : cfCountryRaw;
      const result = await service.generateSubscription(params.token, {
        ip: request.ip,
        userAgent,
        topN: query.topN,
        cfCountry,
      });

      // Slice 30 — host-level format gating. Each endpoint carries an
      // optional `disableForFormats[]` from its originating host row; we
      // filter before invoking the format-specific formatter so each
      // formatter can stay agnostic of host presence.
      const filtered = result.endpoints.filter(
        (e) => !(e.disableForFormats ?? []).includes(format),
      );
      const filteredPlain = result.endpoints
        .filter((e) => !(e.disableForFormats ?? []).includes('plain'))
        .map((e) => e.uri);

      // Slice S1 — emit subscription-metadata HTTP headers every client
      // app reads to set its profile name, refresh interval, quota gauge,
      // support link, and announce banner. Done after generateSubscription
      // so we have the user's traffic/expire snapshot.
      await applySubscriptionHeaders(reply, result.json.user);

      // Wave-14 #6: browser navigation → human-readable landing page instead
      // of the base64 `plain` dump. Uses the same generated data; emits no
      // config, just links + copy + per-format download buttons.
      if (wantsHtmlPage(query, (request.headers.accept ?? '').toString())) {
        const settings = await getSubscriptionSettings();
        const subUrl = `${config.PUBLIC_URL}${config.SUBSCRIPTION_PATH_PREFIX}/${params.token}`;
        const protocols = [...new Set(result.endpoints.map((e) => e.protocol))];
        return reply.type('text/html; charset=utf-8').send(
          buildSubscriptionPage({
            brandTitle: settings.profileTitle ?? settings.brandName ?? 'Iceslab',
            lang: pickLang(request.headers['accept-language'] as string | undefined),
            subUrl,
            supportUrl: settings.supportUrl,
            user: result.json.user,
            protocols,
          }),
        );
      }

      switch (format) {
        case 'json':
          return reply
            .type('application/json')
            .send({ ...result.json, endpoints: filtered });
        case 'clash':
          return reply
            .type('text/yaml; charset=utf-8')
            .send(buildClashYaml(filtered));
        case 'singbox': {
          // Map shared bundle param to singbox values. 'flat' / 'balancer'
          // are xray-specific; in sing-box context they mean the default
          // selector form.
          const sbBundle: 'selector' | 'url-test' | undefined =
            query.bundle === 'url-test' || query.bundle === 'selector'
              ? query.bundle
              : undefined;
          return reply
            .type('application/json')
            .send(buildSingboxJson(filtered, { bundle: sbBundle }));
        }
        case 'wgconf':
          // Content-Disposition with .conf suffix so browser saves the
          // file as `<username>.conf` rather than the raw token path.
          // AmneziaVPN / wg-quick / Hiddify file-pickers all filter by
          // *.conf — without the suffix admin gets an extensionless
          // download that fails the picker filter on Windows / macOS.
          // Caught live cycle #6 2026-05-13 (operator's iPhone test).
          return reply
            .type('text/plain; charset=utf-8')
            .header(
              'Content-Disposition',
              `attachment; filename="${sanitizeFilename(result.json.user.username)}.conf"`,
            )
            .send(buildWgQuickConf(filtered));
        case 'xrayjson': {
          const xjBundle: 'flat' | 'balancer' | undefined =
            query.bundle === 'balancer' || query.bundle === 'flat'
              ? query.bundle
              : undefined;
          return reply
            .type('application/json')
            .send(buildXrayJson(filtered, { bundle: xjBundle }));
        }
        case 'plain':
        default:
          return reply
            .type('text/plain; charset=utf-8')
            .send(Buffer.from(filteredPlain.filter((u) => u.length > 0).join('\n'), 'utf8').toString('base64'));
      }
    } catch (err) {
      if (err instanceof service.SubscriptionNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof service.SubscriptionForbiddenError) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: err.message,
          reason: err.reason,
        });
      }
      throw err;
    }
  });
}
