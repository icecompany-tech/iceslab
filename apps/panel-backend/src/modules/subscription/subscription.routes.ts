import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import {
  FORMAT_NAMES,
  PROTOCOL_NAMES,
  ROUTING_PRESET_IDS,
  formatDisabledForHost,
  isHappUserAgent,
  showsServerDescription,
  type ProtocolName,
  type RoutingPresetId,
} from '@iceslab/shared';
import { parseProtocolsParam, protocolsOf, withProtocols } from './subscription.protocols.js';
import * as service from './subscription.service.js';
import { buildClashYaml } from './formats/clash.js';
import { buildSingboxJson } from './formats/singbox.js';
import { buildWgQuickConf } from './formats/wgconf.js';
import { buildAwgVpnLink } from './formats/amneziavpn.js';
import { buildXrayJson, buildXrayJsonArray } from './formats/xrayjson.js';
import { buildOutlineJson, outlineAccessKey } from './formats/outline.js';
import { buildSurgeConf } from './formats/surge.js';
import { buildQuantumultXConf } from './formats/quantumultx.js';
import { buildLoonConf } from './formats/loon.js';
import { buildSubscriptionPage, missingSubscriptionPage } from './subscription.page.js';
import { subscriptionUrl } from './subscription.link.js';
import { linkWithDescription } from './subscription.description.js';
import { endpointsForFormat, isPlainXray, withoutDescription, type SubscriptionEndpoint } from './subscription.formats.js';
import { endpointId, pickServer } from './endpoint-identity.js';
import { matchRuleForUserAgent } from '../srr/srr.service.js';
import type { ResolvedPreset } from '../routing-presets/routing-presets.resolve.js';
import { frameFor, templateTypeForFormat } from '../subscription-templates/templates.service.js';
import { frameIncludesHidden, type Frame } from './subscription.frames.js';
import type { DeviceRouteRule } from '../routing-presets/routing-presets.builtins.js';
import {
  formatBytes,
  getSubscriptionSettings,
  renderAnnounce,
} from '../settings/settings.service.js';
import { effectiveHwidLimit, enforceHwid } from '../hwid/hwid.service.js';
import { prisma } from '../../prisma.js';
import { config } from '../../config.js';
import { subscriptionRequests } from '../../lib/infra/metrics.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/notify/telegram-notify.js';
import { redis } from '../../lib/infra/redis.js';
import { isPublicRoutableIp } from '../../lib/util/ip.js';
import { headerSafeUrl } from '../../lib/util/header-url.js';

const TokenParamSchema = z.object({
  token: z.string().min(8).max(128),
});

// From the shared list, not a copy of it. The copy in hosts.schemas.ts drifted
// by two names in one direction and one in the other, and the visible symptom
// was a 400 on saving a host with a format this route serves happily.
const FormatEnum = z.enum(FORMAT_NAMES);
type Format = z.infer<typeof FormatEnum>;

const QuerySchema = z.object({
  format: FormatEnum.optional(),
  // Slice 29: outbound group flavour. Per-format semantics:
  //   sing-box   : 'selector' (default) | 'url-test'   (auto-failover)
  //   xray-json  : 'flat'     (default) | 'balancer'   (observatory+leastPing)
  //   clash      : already always emits url-test in its proxy-groups
  // We share one query param across formats because admins picking the
  // "smart auto-failover" form usually want it everywhere their clients
  // see it, not per-format.
  bundle: z.enum(['selector', 'url-test', 'flat', 'balancer']).optional(),
  // Slice 28: when set, cap subscription to top-N nodes ranked by region
  // match (CF-IPCountry) + current utilization. Default (omitted) keeps
  // legacy "return everything" behaviour so existing clients don't regress.
  // Capped at 32 to avoid pathological "give me 9999" requests.
  topN: z.coerce.number().int().min(1).max(32).optional(),
  // Routing Templates (R1a) - per-request override of the panel-wide
  // `subscriptionRoutingPreset` setting. Lets the admin smoke-test a preset
  // on one client before flipping it for everyone (same idea as `bundle`).
  // Only meaningful for full-config formats (clash/singbox/xrayjson).
  routing: z.enum(ROUTING_PRESET_IDS).optional(),
  // A-236: the operator template the file is framed by, by name (same idea as
  // `?routing=`). Default when absent.
  template: z.string().trim().min(1).max(64).optional(),
  // TLS-fragment - per-request override of the panel-wide
  // `subscriptionTlsFragment` setting (same idea as `?routing=`). `1` forces
  // it on, `0` forces it off. Only meaningful for the xrayjson format - the
  // fragment outbound + dialerProxy is an Xray-native technique.
  fragment: z.enum(['0', '1']).optional(),
  // Node selector for single-node formats (wgconf, amneziavpn, outline).
  // wg-quick holds one tunnel per file and an Outline key one server, so a user
  // with several such nodes gets one link per node, each pinned with
  // `?node=<endpoint id>` (endpointId, A-107); the label the links carried
  // before is still taken when no id matches (pickServer). Omitted = the first.
  node: z.string().min(1).max(64).optional(),
  // Human landing-page language override. The page renders an in-page RU/EN
  // selector that links here; it wins over the panel default and the
  // Accept-Language guess. Only meaningful for the HTML page.
  lang: z.enum(['ru', 'en']).optional(),
  // "Save this instead of showing it." A SEPARATE flag rather than a property
  // of the format, because the format addresses are what clients subscribe to:
  // `?format=clash` and `?format=singbox` are pasted into apps and polled for
  // months, and quietly attaching a Content-Disposition to them changes a
  // contract nobody asked us to change. The download buttons on the human page
  // pass `&dl=1`; every existing address stays byte for byte what it was.
  dl: z.enum(['0', '1']).optional(),
  // Only these protocols (subscription.protocols.ts), comma-separated. Read
  // and checked by parseProtocolsParam before this schema runs, so an unknown
  // name is answered by name; here it only has to be a string.
  protocols: z.string().max(256).optional(),
});

/**
 * Formats a comment can stand in, as the first line of an otherwise empty
 * file. Everything else answers a narrowing that left nothing with a 404 in
 * words: JSON has no comments, and a base64 list or a key with a stray line in
 * it is a broken subscription rather than an empty one.
 */
const COMMENTED_FORMATS: ReadonlySet<Format> = new Set<Format>([
  'clash',
  'mihomo',
  'stash',
  'clash-legacy',
  'wgconf',
  'surge',
  'quantumultx',
  'loon',
]);

/** Formats that carry ONE server, picked by `?node=`, and the protocol it is. */
const SINGLE_SERVER_FORMATS: Partial<Record<Format, string>> = {
  wgconf: 'amneziawg',
  amneziavpn: 'amneziawg',
  outline: 'shadowsocks',
};

/**
 * Why a narrowed subscription gave this format nothing, in the terms the
 * person can act on. Two different answers, and mixing them read as a
 * contradiction on the stand (26.09): "no hosts of amneziawg ... it has
 * hysteria, xray, amneziawg".
 *   - a protocol the person does not have: "no hosts of", and what they have;
 *   - a protocol they have and this format cannot carry (AmneziaWG in the
 *     base64 list, MTProto in any config): the format is the reason, and the
 *     page is where it lives.
 */
export function emptyNarrowingWords(
  format: string,
  asked: readonly string[],
  available: readonly string[],
): string {
  const missing = asked.filter((p) => !available.includes(p));
  const notCarried = asked.filter((p) => available.includes(p));
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `this subscription has no hosts of ${missing.join(', ')}` +
        (available.length > 0 ? ` (it has ${available.join(', ')})` : ''),
    );
  }
  if (notCarried.length > 0) {
    const what = notCarried.every((p) => p === 'amneziawg') ? 'key' : 'link';
    parts.push(
      `the ${format} format does not carry ${notCarried.join(', ')}; ` +
        `${notCarried.length === 1 ? 'its' : 'their'} ${what} is on the subscription page`,
    );
  }
  return parts.join('; ');
}

const FORMAT_VALUES: ReadonlySet<Format> = new Set(FormatEnum.options);

function isFormat(value: string): value is Format {
  return FORMAT_VALUES.has(value as Format);
}

/**
 * Resolve which format the client wants, in this priority order:
 *   1. Explicit `?format=` always wins.
 *   2. SRR (Subscription Response Rules): UA regex match against admin-
 *      defined rules in DB. Default seed rules cover Hiddify/Clash/v2rayN/
 *      sing-box/AmneziaWG-app + a `.*` catch-all → `plain`.
 *   3. Legacy Accept-header heuristic (`application/json` → `json`) for the
 *      IcePath-VPN bot integration that predates SRR.
 *   4. `plain` fallback (base64 URI list, universal).
 */
/**
 * Slice S1: set the subscription-metadata HTTP headers most VPN clients
 * read alongside the body. Conventions across Hiddify/V2RayNG/Streisand/
 * Happ/Mihomo:
 *
 *   Profile-Title              - display name in the client's profile list
 *   Profile-Update-Interval    - refresh cadence in HOURS (clients re-fetch
 *                                without admin intervention)
 *   Subscription-Userinfo      - `upload=N; download=N; total=N; expire=T`
 *                                (RFC-3339-ish), drives the quota gauge
 *   Support-URL                - clickable link in the profile detail page
 *   Announce                   - short banner shown to the user (rendered
 *                                template, supports {{TRAFFIC_LEFT}} etc.)
 *
 * Only well-formed values are emitted, admins can leave any setting NULL
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
  // A-168: normalised on the way out too, for a value stored before the
  // schema did it. A raw non-ASCII URL here threw ERR_INVALID_CHAR and took
  // /sub down for every user; one that cannot be made safe is left out.
  // The other operator-set headers are base64 (Profile-Title, Announce) or a
  // number (Profile-Update-Interval).
  const supportUrl = headerSafeUrl(settings.supportUrl);
  if (supportUrl) reply.header('Support-URL', supportUrl);

  // Subscription-Userinfo. `upload+download === used`. We don't track
  // upload separately yet (per-user xray stats sum both directions),
  // so attribute everything to `download` and report `upload=0`, clients
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

  // Announce: rendered template. Skip emission if template empty.
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
      // emit both forms: Happ reads `Announce-URL`-style raw, Hiddify
      // base64. Stick with `Announce: base64:<...>` which both accept.
      reply.header(
        'Announce',
        `base64:${Buffer.from(announce, 'utf8').toString('base64')}`,
      );
    }
  }
}

/**
 * The format, and the template the SRR rule that chose it names (A-236 step
 * 4; null when no rule chose, or the rule names none).
 */
async function resolveFormat(
  query: z.infer<typeof QuerySchema>,
  acceptHeader: string,
  userAgent: string | null,
): Promise<{ format: Format; ruleTemplate: string | null }> {
  if (query.format) return { format: query.format, ruleTemplate: null };
  const matched = await matchRuleForUserAgent(userAgent);
  if (matched && isFormat(matched.format)) return { format: matched.format, ruleTemplate: matched.templateName };
  if (acceptHeader.toLowerCase().includes('application/json')) return { format: 'json', ruleTemplate: null };
  // Last resort, and since 2026-09-21 the operator's choice rather than ours.
  // plain stays the default of that setting: it is the one form every
  // client can read, so an operator who has not decided keeps what worked.
  return { format: (await getSubscriptionSettings()).defaultFormat, ruleTemplate: null };
}

// Wave-14 #6: a browser navigating to /sub/<token> should see a human page,
// not a base64 dump. Trigger on Accept: text/html with no explicit ?format,
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

/**
 * The page for a subscription that is not in force.
 *
 * Built from the refusal rather than from a subscription: there are no
 * endpoints to show and no configs to offer, so what is left is who this is,
 * why nothing works, and how to fix it. The install block renders itself away
 * on an empty protocol list, which is the honest shape here.
 *
 * `reason` beats the stored status on purpose. A revoked link belongs to a
 * user whose row still says `active`, and "active" is the one word this page
 * must not print to somebody it has just turned away.
 *
 * Returns undefined when even the name cannot be found (a token pointing at a
 * deleted user): the caller then falls back to the JSON, because a page about
 * nobody is worse than an error object.
 */
async function refusalPage(
  token: string,
  reason: 'REVOKED' | 'DISABLED' | 'EXPIRED' | 'LIMITED',
  query: { lang?: 'ru' | 'en' },
  request: FastifyRequest,
): Promise<string | undefined> {
  const user = await prisma.user.findFirst({
    where: { subscriptionToken: token, deletedAt: null },
    select: {
      username: true,
      expireAt: true,
      trafficLimitBytes: true,
      traffic: { select: { usedTrafficBytes: true } },
    },
  });
  if (!user) return undefined;
  const settings = await getSubscriptionSettings();
  return buildSubscriptionPage({
    brandTitle: settings.profileTitle ?? settings.brandName ?? 'Iceslab',
    lang:
      query.lang ??
      settings.defaultLocale ??
      pickLang(request.headers['accept-language'] as string | undefined),
    subUrl: await subscriptionUrl(token),
    supportUrl: settings.supportUrl,
    user: {
      username: user.username,
      status: reason.toLowerCase(),
      expireAt: user.expireAt ? user.expireAt.toISOString() : null,
      trafficLimitBytes: user.trafficLimitBytes !== null ? Number(user.trafficLimitBytes) : null,
      trafficUsedBytes: user.traffic ? Number(user.traffic.usedTrafficBytes) : 0,
    },
    // No endpoints exist for a refused subscription, so no clients are named
    // and no config is offered. Both blocks take themselves off the page.
    protocols: [],
    // Именно эта страница и читает тексты оператора: сюда попадает тот, кому
    // отказали, и строка под его именем это единственное, что ему скажут.
    deadTexts: settings.deadTexts,
  });
}


// Strip characters Content-Disposition can't legally carry to keep
// browsers happy across OSes. Username comes from admin-controlled
// input so paranoia is cheap; whitelist [a-zA-Z0-9._-], fold rest to
// underscore, cap length to keep filesystem-safe.
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return cleaned || 'subscription';
}

/** What a saved file of this format should be called. */
const DOWNLOAD_EXT: Partial<Record<Format, string>> = {
  json: 'json',
  clash: 'yaml',
  singbox: 'json',
  xrayjson: 'json',
  'xrayjson-array': 'json',
  xkeen: 'json',
  outline: 'json',
  wgconf: 'conf',
  amneziavpn: 'txt',
  surge: 'conf',
  quantumultx: 'conf',
  loon: 'conf',
};

/**
 * `<user>[-<node>]-<format>.<ext>`, so several saved files can be told apart.
 *
 * ⚠ `plain` is deliberately absent from the table above and never reaches
 * here: it is the raw subscription clients pull from the link itself, and it
 * is the one address this flag must not touch at all.
 */
function downloadFilename(format: Format, username: string, node?: string): string {
  const ext = DOWNLOAD_EXT[format] ?? 'txt';
  const nodePart = node ? `-${sanitizeFilename(node)}` : '';
  return `${sanitizeFilename(username)}${nodePart}-${format}.${ext}`;
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // Secondary IP-only ceiling. The route's primary rate-limit is keyed on
  // (ip, token): legit, but an attacker rotates tokens to dodge it. This
  // hook caps total /sub hits per IP via a sliding Redis bucket, well
  // above legit shared-CGNAT polling so real users never feel it.
  async function ipRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ip = request.ip;
    const key = `sec:sub-ip:${ip}`;
    // Atomic INCR + (set TTL if first). Prior version did INCR then EXPIRE
    // in two round-trips, if the process crashed between them, the key
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

  // GET /sub/:token - public (the token IS the credential).
  // Two-bucket rate-limit:
  //   - per-(ip,token) bucket caps a legit client's polling rate
  //   - per-(ip) bucket via ipRateLimitHook catches token-rotation
  // Path prefix is admin-configurable via SUBSCRIPTION_PATH_PREFIX env
  // (default `/sub`). Lets operators mask Iceslab signature on the
  // wire, e.g. `/v` so user links look like https://panel/v/<token>.
  const subOptions: RouteShorthandOptions = {
    onRequest: [ipRateLimitHook],
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_SUB_PER_MIN,
        timeWindow: '1 minute',
        // Per-token bucket so one client polling on the same token doesn't
        // share rate-budget with unrelated subscriptions on shared CGNAT.
        // The client segment does not split it: one token, one bucket.
        keyGenerator: (req: FastifyRequest) => {
          const t = (req.params as { token?: string })?.token ?? 'unknown';
          return `${req.ip}:${t}`;
        },
      },
    },
  };
  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = TokenParamSchema.parse(request.params);
    const userAgent = typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null;
    const client = (request.params as { client?: string }).client;

    // Tier-1 honey-user tripwire. If the requested token is on the admin's
    // canary list, the token by definition was leaked from where it was
    // planted (pastebin, screenshot, dropped USB, …). Alert immediately,
    // blacklist the source IP (same Redis key as the path-honeypot), and
    // return a plausible-empty 200, making the attacker believe their
    // exfiltrated token is "just empty subscription" instead of "this is
    // a panel that knows it was leaked."
    // First, before the client segment, the format and the protocols are
    // read: ANY use of a canary trips it, a typo in the rest included (A-243,
    // step 5 follow-up). So the alert names what was asked, not the format
    // resolved.
    if (config.HONEY_USER_TOKENS.includes(params.token)) {
      const ip = request.ip;
      const ttl = config.HONEYPOT_BLACKLIST_TTL_SEC;
      const askedFormat = (request.query as { format?: unknown } | undefined)?.format;
      // Cut to 64: the string is the requester's, of any length (AUDT, A-255).
      const asked = (client !== undefined ? `/${client}` : typeof askedFormat === 'string' ? askedFormat : 'auto').slice(0, 64);
      // Only blacklist real public IPs. If TRUST_PROXY_HOPS is misconfigured
      // an attacker can spoof X-Forwarded-For with a private/loopback IP and
      // get arbitrary legit users DoS'd via this honeypot. Skip the blacklist
      // for any IP we can identify as non-routable; still alert + return empty.
      if (isPublicRoutableIp(ip)) {
        await redis.set(`sec:blacklist:${ip}`, '1', 'EX', ttl, 'NX').catch(() => null);
      }
      notifyTelegramAsync(
        `🪤 *Honey-user token used*\nip: \`${escapeMarkdown(ip)}\`\nua: \`${escapeMarkdown(userAgent ?? '?')}\`\nformat: \`${escapeMarkdown(asked)}\`\ntoken: \`${escapeMarkdown(params.token.slice(0, 6))}...\``,
      );
      // Plausible empty subscription. Mirror the same content-type the
      // legit path would use for `?format=plain`.
      reply.type('text/plain; charset=utf-8');
      return reply.send('');
    }

    // A-236 step 5: /sub/<token>/<client>. The segment IS an explicit
    // format, the same as `?format=` and winning over the User-Agent rules,
    // for the clients that cannot set a User-Agent and for a QR made for one
    // client. A slug nobody knows is answered by name. The path segment wins
    // over ?format= when both are given.
    if (client !== undefined) {
      const slugFormat = CLIENT_SLUGS[client];
      if (!slugFormat) {
        return reply.code(404).send({
          error: 'UNKNOWN_CLIENT',
          message: `unknown client ${JSON.stringify(client)} in the path. This build answers: ${Object.keys(CLIENT_SLUGS).join(', ')}`,
        });
      }
      (request.query as Record<string, unknown>).format = slugFormat;
    }
    // A format nobody serves is answered by NAME. `QuerySchema.parse` throws a
    // Zod error that the handler turns into a bare 400, so a client asking for
    // a format this build does not have got "Bad Request" and no way to tell a
    // typo from a version that is too old. The reader here is usually a client
    // app's config, not a person, but the person debugging it is who needs the
    // sentence.
    const raw = (request.query ?? {}) as { format?: unknown };
    if (typeof raw.format === 'string' && !isFormat(raw.format)) {
      return reply.code(400).send({
        error: 'UNKNOWN_FORMAT',
        message:
          `unknown subscription format ${JSON.stringify(raw.format)}. This build serves: ` +
          `${FORMAT_NAMES.join(', ')}`,
      });
    }
    // Same for a protocol: by name, with the list it is not in.
    const protocolFilter = parseProtocolsParam((raw as { protocols?: unknown }).protocols);
    if (protocolFilter.kind === 'unknown') {
      return reply.code(400).send({
        error: 'SUBSCRIPTION_PROTOCOL_UNKNOWN',
        message:
          `unknown protocol ${JSON.stringify(protocolFilter.protocol)} in ?protocols=. ` +
          `The panel's protocols are: ${PROTOCOL_NAMES.join(', ')}`,
        protocol: protocolFilter.protocol,
        known: [...PROTOCOL_NAMES],
      });
    }
    const onlyProtocols = protocolFilter.kind === 'some' ? protocolFilter.protocols : null;
    const query = QuerySchema.parse(request.query);
    const { format, ruleTemplate } = await resolveFormat(
      query,
      (request.headers.accept ?? '').toString(),
      userAgent,
    );
    subscriptionRequests.inc({ format });

    try {
      // Slice S2: HWID enforcement runs BEFORE generateSubscription so
      // a denied client doesn't burn a subscription_request_history row
      // or stress the binding query. Cost is one cheap user lookup.
      const hwidHeader = request.headers['x-hwid'];
      const hwid =
        typeof hwidHeader === 'string' && hwidHeader.length > 0 && hwidHeader.length <= 255
          ? hwidHeader
          : null;
      const userMin = await prisma.user.findFirst({
        where: { subscriptionToken: params.token, deletedAt: null },
        select: {
          id: true,
          hwidDeviceLimit: true,
          // K7 - the user's squads' HWID-limit defaults (used when the user has
          // no explicit limit).
          groupMembers: { select: { group: { select: { hwidDeviceLimit: true } } } },
        },
      });

      // A-236: `?template=<name>` picks the operator template the file is
      // framed by; a format no template frames, or a name the type does not
      // have, is a refusal in words, not a silent Default. Asked only here
      // (A-243): after the honey-token trap above, so a leaked canary with a
      // made-up template still trips it, and only for a token that exists, so
      // the operator's template names cannot be probed with any string in
      // place of a token (an unknown token answers 404 the same with or
      // without a template, below). Before the HWID check, so a refused
      // request does not register a device.
      // The frame itself (step 3): the named template, or the type's Default
      // (absent while it is the code's, so the builders' own Default and its
      // bundles stand).
      let frame: Frame | undefined;
      const templateType = templateTypeForFormat(format);
      if (userMin && query.template !== undefined && !templateType) {
        return reply.code(400).send({
          error: 'TEMPLATE_NOT_FOR_FORMAT',
          message: `the ${format} format takes no template; templates frame mihomo, clash, stash, clash-legacy, singbox, xrayjson and xrayjson-array`,
        });
      }
      if (userMin && templateType) {
        // Step 4: an explicit ?template= first, then the template the SRR
        // rule that chose the format names. A rule's template that was deleted
        // since falls back to the Default instead of failing every client the
        // rule serves; only an explicit name is refused.
        const named = query.template ?? ruleTemplate ?? 'Default';
        let picked = await frameFor(templateType, named);
        if (!picked.found && query.template === undefined) picked = await frameFor(templateType, 'Default');
        if (!picked.found) {
          return reply.code(404).send({
            error: 'TEMPLATE_NOT_FOUND',
            message: `no ${templateType} template named ${JSON.stringify(query.template)}`,
          });
        }
        frame = picked.frame;
      }

      if (userMin) {
        // K7 - explicit per-user limit wins, 0 there is an explicit no-limit
        // (A-148); otherwise the most-permissive squad default.
        const hwidLimit = effectiveHwidLimit(
          userMin.hwidDeviceLimit,
          userMin.groupMembers.map((m) => m.group.hwidDeviceLimit),
        );
        const hwidResult = await enforceHwid(userMin.id, hwid, hwidLimit);
        // Always emit the gauge header so the client can render "2/3" in
        // its profile detail UI, even on success, even when no limit set.
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
          // 403 with a structured body, clients that don't read headers
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
      const generated = await service.generateSubscription(params.token, {
        ip: request.ip,
        userAgent,
        topN: query.topN,
        cfCountry,
        // A-167: a client's fetch is history; the page in a browser is not,
        // nothing there carries a config to a client.
        recordFetch: !wantsHtmlPage(query, (request.headers.accept ?? '').toString()),
      });
      // ?protocols=: narrowed HERE, once, on what the subscription hands out,
      // before any format or the page sees it. After the generation and not
      // inside it, so what is cached per squad set (bindings-cache) stays the
      // whole subscription and one person's narrowed link cannot become
      // another's answer. A cascade line goes with its endpoint, whose
      // protocol is the cascade entry's.
      // A-236 step 6. A host's description goes only to the apps that show one
      // (DESCRIPTION_CLIENTS); for every other client it is taken off here, so
      // no builder and no `json` answer carries it. A hidden host is in no
      // public output below, the page and its format list included, unless
      // the template asks for hidden hosts, and then only in this format's
      // file (`framed`).
      const describe = showsServerDescription(userAgent);
      const happ = isHappUserAgent(userAgent);
      const every = describe ? generated.endpoints : generated.endpoints.map(withoutDescription);
      const visible = every.filter((e) => !e.hidden);
      const narrow = (eps: SubscriptionEndpoint[]) =>
        onlyProtocols ? eps.filter((e) => onlyProtocols.includes(e.protocol as ProtocolName)) : eps;
      const availableProtocols = protocolsOf(visible);
      const result = { ...generated, endpoints: narrow(visible) };
      const framed = frame && frameIncludesHidden(frame) ? narrow(every) : result.endpoints;

      // Slice 30: host-level format gating. Each endpoint carries an
      // optional `disableForFormats[]` from its originating host row; we
      // filter before invoking the format-specific formatter so each
      // formatter can stay agnostic of host presence.
      // A-249: clash and mihomo are one format under two names here
      // (formatDisabledForHost), so a host switched off for Clash before the
      // family was split by core stays off for its mihomo clients.
      const filtered = framed.filter(
        (e) => !formatDisabledForHost(e.disableForFormats, format),
      );
      // What THIS format carries, by FORMAT_DOORS: every builder below is
      // handed this list and no other, so the table the screens read and the
      // file a client receives are one decision (see endpointsForFormat).
      const served = endpointsForFormat(format, filtered);
      // One line per server, when the operator asked for that. Applied here
      // and nowhere else: the whole-config formats keep every endpoint, so a
      // collapsed protocol is still downloadable from the page.
      const lineShape = (await getSubscriptionSettings()).linkShape;
      const plainSource =
        lineShape === 'per-node'
          ? service.collapseToOneLinePerNode(result.endpoints)
          : result.endpoints;
      // The share links of a links format: `plain` (base64) and `raw` (the
      // same lines unwrapped, A-236), each gated and switched off per host by
      // its own name.
      const linksFor = (fmt: 'plain' | 'raw') =>
        endpointsForFormat(
          fmt,
          plainSource.filter((e) => !formatDisabledForHost(e.disableForFormats, fmt)),
        )
          // A4: a balancer-cascade entry expands into one re-tagged URI per exit;
          // other endpoints pass through. (This note used to claim the JSON array
          // is not pingable in Happ. It is - checked in the field 2026-08-16 - and
          // the claim had been steering design decisions.)
          .flatMap((e) => {
            const uris = service.expandEndpointUris(e);
            // A-236 step 6: Happ reads the description in the link itself.
            const d = happ ? e.serverDescription : undefined;
            return d ? uris.map((u) => (u ? linkWithDescription(u, d) : u)) : uris;
          });
      const filteredPlain = linksFor('plain');

      // Slice S1: emit subscription-metadata HTTP headers every client
      // app reads to set its profile name, refresh interval, quota gauge,
      // support link, and announce banner. Done after generateSubscription
      // so we have the user's traffic/expire snapshot.
      await applySubscriptionHeaders(reply, result.json.user);

      // Wave-14 #6: browser navigation → human-readable landing page instead
      // of the base64 `plain` dump. Uses the same generated data; emits no
      // config, just links + copy + per-format download buttons.
      if (wantsHtmlPage(query, (request.headers.accept ?? '').toString())) {
        // The page is public whatever template the format has: no hidden host
        // on it, even when a frame above asked for them (A-236 step 6).
        const filtered = result.endpoints.filter((e) => !formatDisabledForHost(e.disableForFormats, format));
        const settings = await getSubscriptionSettings();
        // The narrowing travels in every link the page prints, so what a
        // person copies, scans or adds is what this page lists.
        const subUrl = withProtocols(await subscriptionUrl(params.token), onlyProtocols ?? []);
        const protocols = [...new Set(result.endpoints.map((e) => e.protocol))];
        // One QR pair per AmneziaWG node (deduped by node name). wg-quick / vpn://
        // are single-tunnel-per-key, so a user with several AWG servers gets each
        // server's own labelled QR (.conf for the AmneziaWG app, vpn:// for the
        // AmneziaVPN app) instead of only the first node's. ecl 'L' keeps the long
        // payloads scannable.
        const awgSeen = new Set<string>();
        const awgNodes = filtered
          .filter((e) => e.protocol === 'amneziawg')
          .filter((e) => !awgSeen.has(e.nodeName) && !!awgSeen.add(e.nodeName))
          .map((e) => {
            // By the endpoint's id, the key the per-node links carry (A-107).
            const id = endpointId(e);
            const conf = buildWgQuickConf(filtered, id);
            const vpn = buildAwgVpnLink(filtered, id);
            return {
              nodeName: e.nodeName,
              id,
              // The PAYLOADS, not pictures of them. The codes are drawn in the
              // browser now: three server-rendered SVGs cost about 49 KB gzip
              // on this page, the encoder costs 4.3 KB once, and the code on
              // the wire is the same code. See subscription.page-qr.ts.
              conf: conf || undefined,
              // Raw vpn:// key: also what the copy button hands over, since the
              // dense key QR is unreliable on screen and paste-the-key is the
              // robust path.
              vpnKey: vpn || undefined,
              // t07-6c: the page names the app version a 3.1 tunnel needs.
              ...((e as { geometry3?: unknown }).geometry3 ? { awg3: true } : {}),
            };
          });
        /**
         * One row per MTProto node, with the link already built.
         *
         * The page showed a Telegram card with instructions and NO proxy link,
         * so the only way to actually use an MTProto node was to read the raw
         * subscription and find the `tg://` line by hand (issue #41). Both
         * forms exist on the endpoint already: `tg://` opens the app directly,
         * `https://t.me/proxy?...` works as a clickable link anywhere, which is
         * the one to hand somebody.
         *
         * Deduped by node, like the AmneziaWG files: mtg is single-secret per
         * inbound, so every user on that squad gets the same link, and a node
         * appearing twice would be the same link twice.
         */
        const mtSeen = new Set<string>();
        const mtprotoNodes = filtered
          .filter((e) => e.protocol === 'mtproto')
          .filter((e) => !mtSeen.has(e.nodeName) && !!mtSeen.add(e.nodeName))
          .map((e) => ({
            nodeName: e.nodeName,
            uri: (e as { uri?: string }).uri ?? '',
            tmeUri: (e as { tmeUri?: string }).tmeUri ?? '',
          }))
          .filter((n) => n.uri !== '');
        // SOCKS5 / HTTP for Telegram: one row per endpoint, not per node, and
        // no dedupe, because the login in each is this person's own.
        const telegramProxies = filtered.filter(isPlainXray).map((e) => ({
          nodeName: e.nodeName,
          kind: e.subprotocol,
          tgUri: e.tgUri,
          host: e.host,
          port: e.port,
          username: e.username,
          password: e.password,
        }));
        // One Outline key per Shadowsocks node, as the AmneziaWG pairs: a key
        // carries one server. Through the same gate as the file itself, so a
        // node on a 2022-blake3 cipher, which Outline cannot read, gets no key.
        const ssSeen = new Set<string>();
        const outlineNodes = endpointsForFormat(
          'outline',
          result.endpoints.filter((e) => !formatDisabledForHost(e.disableForFormats, 'outline')),
        )
          .filter((e) => !ssSeen.has(e.nodeName) && !!ssSeen.add(e.nodeName))
          .flatMap((e) => {
            const key = outlineAccessKey(subUrl, endpointId(e), e.nodeName);
            return key ? [{ nodeName: e.nodeName, key }] : [];
          });
        // The page's URL is the subscription: a link out of it must not carry
        // it in Referer, on an install with no frontend nginx setting the
        // header either (A-267, AUDT).
        return reply.type('text/html; charset=utf-8').header('referrer-policy', 'no-referrer').send(
          buildSubscriptionPage({
            brandTitle: settings.profileTitle ?? settings.brandName ?? 'Iceslab',
            // Language priority: in-page ?lang selector (per visitor) > panel
            // default (mirrored from the operator's UI language) > the visitor's
            // Accept-Language guess.
            lang:
              query.lang ??
              settings.defaultLocale ??
              pickLang(request.headers['accept-language'] as string | undefined),
            subUrl,
            supportUrl: settings.supportUrl,
            user: result.json.user,
            protocols,
            protocolSwitch: { available: availableProtocols, selected: onlyProtocols ?? [] },
            // A download row is offered exactly when its file would carry
            // something: the same gate and the same host switches the file
            // itself goes through.
            carriedFormats: FORMAT_NAMES.filter(
              (f) =>
                endpointsForFormat(
                  f,
                  result.endpoints.filter((e) => !formatDisabledForHost(e.disableForFormats, f)),
                ).length > 0,
            ),
            awgNodes,
            mtprotoNodes,
            telegramProxies,
            outlineNodes,
            deadTexts: settings.deadTexts,
          }),
        );
      }

      // Routing Templates - resolve the preset only for full-config formats.
      // Precedence (R1a + R3-a + R3): `?routing=` query wins, then the user's
      // per-user override, then their per-squad override, then the panel-wide
      // setting. plain/json/wgconf carry no routing section, so we skip the
      // read there.
      // A-229: the resolved preset, a built-in key or an own preset's rules.
      // A built-in goes to the builders as its key; an own preset as its
      // rules (`ownPresetRules`), over the proxy-all base for everything the
      // key decides besides the rules (DNS).
      let preset: ResolvedPreset = { kind: 'builtin', id: 'proxy-all' };
      let routingPreset: RoutingPresetId = 'proxy-all';
      let ownPresetRules: DeviceRouteRule[] | undefined;
      let customRoutingRules: Record<string, unknown>[] | undefined;
      // R3 - operator-defined custom domain lists (direct/proxy/block), emitted
      // into xray + clash routing rules. Undefined = none = byte-identical.
      let customDomainLists: { direct: string[]; proxy: string[]; block: string[] } | undefined;
      // TLS-fragment - `?fragment=` query wins, else the panel-wide setting.
      // Only the xrayjson format reads this (the fragment outbound + dialerProxy
      // is Xray-native); clash/singbox ignore it.
      let tlsFragment = false;
      if (
        format === 'clash' ||
        format === 'mihomo' ||
        format === 'stash' ||
        format === 'clash-legacy' ||
        format === 'singbox' ||
        format === 'xrayjson' ||
        format === 'xrayjson-array' ||
        format === 'xkeen'
      ) {
        const settings = await getSubscriptionSettings();
        preset =
          (query.routing ? { kind: 'builtin', id: query.routing } : null) ??
          result.userPreset ??
          result.squadPreset ??
          { kind: 'builtin', id: settings.routingPreset };
        routingPreset = preset.kind === 'builtin' ? preset.id : 'proxy-all';
        ownPresetRules = preset.kind === 'custom' ? preset.rules : undefined;
        // R3-b custom rules apply only to xray-routing formats (xray/xkeen).
        customRoutingRules = settings.customRoutingRules ?? undefined;
        // R3 custom domain lists apply to xray/xkeen + clash.
        customDomainLists = settings.customDomainLists ?? undefined;
        tlsFragment =
          query.fragment !== undefined ? query.fragment === '1' : settings.tlsFragment;
      }

      // "Save it" rather than "show it", asked for by the page's download
      // buttons. Set once here instead of in a dozen branches, and NOT for
      // `plain`: that is the raw subscription a client pulls from the bare
      // link, and it must keep behaving exactly as it always has. `wgconf` and
      // `xkeen` set their own, better, filename further down and win by
      // writing the header after this.
      // The one server a single-server file is for, by id or label (A-107),
      // and the label it is saved under: an id in a file name reads as noise.
      const singleServerProtocol = SINGLE_SERVER_FORMATS[format];
      const singleServers = singleServerProtocol ? served.filter((e) => e.protocol === singleServerProtocol) : [];
      const nodeLabel = query.node ? (pickServer(singleServers, query.node)?.nodeName ?? query.node) : undefined;
      if (query.dl === '1' && format !== 'plain') {
        reply.header(
          'Content-Disposition',
          `attachment; filename="${downloadFilename(format, result.json.user.username, nodeLabel)}"`,
        );
      }

      /**
       * A narrowing that leaves this format nothing, said in words.
       *
       * Only under ?protocols=: without it every format keeps the contract it
       * has (an empty wgconf body, an empty base64 list), because clients
       * polling those addresses read them that way today. With it, the person
       * asked for something specific, and an empty 200 would read as "the
       * panel is broken" rather than "you have none of those".
       */
      if (onlyProtocols) {
        const carriesNothing =
          format === 'plain'
            ? filteredPlain.every((u) => u.length === 0)
            : format === 'raw'
              ? linksFor('raw').every((u) => u.length === 0)
            : format === 'wgconf'
              ? buildWgQuickConf(served, query.node) === ''
              : format === 'amneziavpn'
                ? buildAwgVpnLink(served, query.node) === ''
                : format === 'outline'
                  ? buildOutlineJson(served, query.node) === ''
                  : served.length === 0;
        if (carriesNothing) {
          // Not a file to save: the sentence is the answer.
          reply.removeHeader('Content-Disposition');
          const words = emptyNarrowingWords(format, onlyProtocols, availableProtocols);
          if (COMMENTED_FORMATS.has(format)) {
            return reply.type('text/plain; charset=utf-8').send(`# ${words}\n`);
          }
          return reply.code(404).send({
            error: 'SUBSCRIPTION_PROTOCOL_EMPTY',
            message: words,
            protocols: onlyProtocols,
            available: availableProtocols,
          });
        }
      }

      /**
       * E54, stand 26.09: a single-server file asked for a server by a name
       * this subscription does not have answered 200 with an empty body, the
       * same as "no such protocol at all", so a mistyped `node=` read as an
       * empty subscription. The name is the server's LABEL as the subscription
       * prints it, flag included ("🇷🇺 awg-ru-01"), which is easy to get
       * wrong by hand; the answer names the ones there are.
       *
       * Only with `node=`: without it these formats keep their contract (the
       * first server, or an empty body when there is none).
       * A-107: `node=` is the endpoint's id in the links the panel hands out;
       * a label is still taken, and the refusal names the labels.
       */
      if (query.node && singleServerProtocol) {
        const names = [...new Set(singleServers.map((e) => e.nodeName))];
        if (!pickServer(singleServers, query.node)) {
          reply.removeHeader('Content-Disposition');
          // The server may exist and be one this format cannot read (an
          // SS2022 cipher for Outline): that is a different sentence.
          const exists = !!pickServer(filtered.filter((e) => e.protocol === singleServerProtocol), query.node);
          const has = names.length > 0 ? `it has: ${names.map((n) => JSON.stringify(n)).join(', ')}` : 'it has none';
          return reply.code(404).send({
            error: 'SUBSCRIPTION_NODE_UNKNOWN',
            message: exists
              ? `the ${format} format cannot carry the server ${JSON.stringify(query.node)}; for this format ${has}`
              : `this subscription has no ${singleServerProtocol} server named ${JSON.stringify(query.node)}; for the ${format} format ${has}`,
            node: query.node,
            nodes: names,
          });
        }
      }

      switch (format) {
        case 'json':
          return reply
            .type('application/json')
            .send({ ...result.json, endpoints: served });
        // A-236 step 4: three Clash-family answers by core. `clash` is the
        // alias of mihomo for good (the address is in clients' configs), byte
        // for byte what it always answered.
        case 'clash':
        case 'mihomo':
        case 'stash':
        case 'clash-legacy':
          return reply
            .type('text/yaml; charset=utf-8')
            .send(
              buildClashYaml(served, {
                routingPreset,
                ownPresetRules,
                customDomainLists,
                frame,
                dialect: format === 'clash' ? 'mihomo' : format,
              }),
            );
        case 'singbox': {
          // TLS-fragment is intentionally NOT emitted for sing-box: the
          // upstream field is unstable across 1.12/1.14 (same rationale as the
          // skipped sing-box DNS split in R2). Xray JSON only.
          // Map shared bundle param to singbox values. 'flat' / 'balancer'
          // are xray-specific; in sing-box context they mean the default
          // selector form.
          const sbBundle: 'selector' | 'url-test' | undefined =
            query.bundle === 'url-test' || query.bundle === 'selector'
              ? query.bundle
              : undefined;
          return reply
            .type('application/json')
            .send(buildSingboxJson(served, { bundle: sbBundle, routingPreset, ownPresetRules, frame }));
        }
        case 'wgconf': {
          // Filename = `<username>-<node>.conf` so a user with several AWG
          // servers can tell the downloaded files apart (the browser otherwise
          // saves test.conf, test(1).conf, ...). The .conf suffix matters: the
          // AmneziaWG / wg-quick / Hiddify file-pickers filter by *.conf, so an
          // extensionless name fails the picker on Windows / macOS.
          const nodePart = nodeLabel ? `-${sanitizeFilename(nodeLabel)}` : '';
          const fname = `${sanitizeFilename(result.json.user.username)}${nodePart}.conf`;
          return reply
            .type('text/plain; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${fname}"`)
            .send(buildWgQuickConf(served, query.node));
        }
        case 'amneziavpn': {
          // AmneziaVPN-app "vpn://" connection key (base64 blob the flagship
          // AmneziaVPN clients import directly: their QR scanner and "paste
          // key" both accept it). Single tunnel per key, so `?node=` selects
          // which AmneziaWG node; absent = first. Empty body = no AWG endpoint
          // for this user (same 204-style contract as wgconf).
          return reply
            .type('text/plain; charset=utf-8')
            .send(buildAwgVpnLink(served, query.node));
        }
        case 'xrayjson': {
          const xjBundle: 'flat' | 'balancer' | undefined =
            query.bundle === 'balancer' || query.bundle === 'flat'
              ? query.bundle
              : undefined;
          return reply
            .type('application/json')
            .send(buildXrayJson(served, { bundle: xjBundle, routingPreset, ownPresetRules, customRules: customRoutingRules, customDomainLists, tlsFragment, frame }));
        }
        case 'xrayjson-array': {
          // A1: top-level JSON array of standalone xray configs (one per
          // endpoint), the shape Happ / V2RayTun parse as N separate servers.
          // Carries the same routing surface as single-config xrayjson, minus
          // `bundle` (no balancer: the client picks a server, not an outbound).
          return reply
            .type('application/json')
            .send(buildXrayJsonArray(served, { routingPreset, ownPresetRules, customRules: customRoutingRules, customDomainLists, tlsFragment, frame }));
        }
        case 'xkeen': {
          // XKeen (xray-core on Keenetic routers): outbounds + routing +
          // split-DNS, NO client inbound (router provides tproxy). Drop-in for
          // confdir 04_outbounds / 05_routing (+ 02_dns). routingPreset is
          // resolved above (defaults to the panel/squad RU-split when set).
          const xkBundle: 'flat' | 'balancer' | undefined =
            query.bundle === 'balancer' || query.bundle === 'flat'
              ? query.bundle
              : undefined;
          return reply
            .type('application/json')
            .header(
              'Content-Disposition',
              `attachment; filename="${sanitizeFilename(result.json.user.username)}-xkeen.json"`,
            )
            .send(buildXrayJson(served, { bundle: xkBundle, routingPreset, ownPresetRules, forRouter: true, customRules: customRoutingRules, customDomainLists }));
        }
        case 'outline':
          // Outline dynamic key: one Shadowsocks server, `?node=` picks which,
          // absent = first. Empty body = no Shadowsocks endpoint Outline can
          // read (same contract as wgconf). The page links it as ssconf://.
          return reply
            .type('application/json')
            .send(buildOutlineJson(served, query.node));
        case 'surge':
          // Surge [Proxy] lines. ss/vmess/trojan/hy2; no vless/REALITY.
          return reply.type('text/plain; charset=utf-8').send(buildSurgeConf(served));
        case 'quantumultx':
          // Quantumult X server_local lines. ss/vmess/vless/trojan incl REALITY.
          return reply.type('text/plain; charset=utf-8').send(buildQuantumultXConf(served));
        case 'loon':
          // Loon proxy lines (best-effort; verify import in-app). ss/vmess/vless/
          // trojan/hy2 incl REALITY.
          return reply.type('text/plain; charset=utf-8').send(buildLoonConf(served));
        case 'raw':
          // A-236: the plain list without the base64, one link per line, for
          // clients and scripts that take links as text.
          return reply
            .type('text/plain; charset=utf-8')
            .send(linksFor('raw').filter((u) => u.length > 0).join('\n'));
        case 'plain':
        default:
          return reply
            .type('text/plain; charset=utf-8')
            .send(Buffer.from(filteredPlain.filter((u) => u.length > 0).join('\n'), 'utf8').toString('base64'));
      }
    } catch (err) {
      if (err instanceof service.SubscriptionNotFoundError) {
        if (wantsHtmlPage(query, (request.headers.accept ?? '').toString())) {
          const settings = await getSubscriptionSettings();
          const html = missingSubscriptionPage({
            brandTitle: settings.profileTitle ?? settings.brandName ?? 'Iceslab',
            lang: query.lang ?? settings.defaultLocale ?? pickLang(request.headers['accept-language'] as string | undefined),
            supportUrl: settings.supportUrl,
          });
          return reply.code(404).type('text/html; charset=utf-8').header('referrer-policy','no-referrer').send(html);
        }
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof service.SubscriptionForbiddenError) {
        // A person in a browser gets the page instead of the JSON. Until now
        // the subscriber whose subscription had just run out - precisely the
        // one worth getting back - was shown a raw error object.
        //
        // The status stays 403 and the JSON stays byte for byte what it was.
        // The only thing that changes is the BODY, and only when the request
        // was already recognised as a browser asking for a page: same
        // condition as the success path, so nothing that reads the 403 sees
        // any difference.
        if (wantsHtmlPage(query, (request.headers.accept ?? '').toString())) {
          const page = await refusalPage(params.token, err.reason, query, request);
          if (page) return reply.code(403).type('text/html; charset=utf-8').header('referrer-policy', 'no-referrer').send(page);
        }
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: err.message,
          reason: err.reason,
        });
      }
      throw err;
    }
  };

  app.get(`${config.SUBSCRIPTION_PATH_PREFIX}/:token`, subOptions, serve);
  app.get(`${config.SUBSCRIPTION_PATH_PREFIX}/:token/:client`, subOptions, serve);
}

/**
 * The client segment of /sub/<token>/<client> (A-236 step 5,
 * docs/plan/subscription-templates.md 4.4) and the format it is. `base64` is
 * the plain list (the `plain` format), named as clients know it; `raw` the
 * same unwrapped; the rest are the format names.
 */
export const CLIENT_SLUGS: Record<string, Format> = {
  mihomo: 'mihomo',
  stash: 'stash',
  clash: 'clash',
  singbox: 'singbox',
  json: 'json',
  base64: 'plain',
  raw: 'raw',
};
