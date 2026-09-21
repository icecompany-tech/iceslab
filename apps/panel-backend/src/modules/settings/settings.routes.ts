import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { request } from 'undici';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { requireAuth } from '../auth/auth.hook.js';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/infra/redis.js';
import { config, subscriptionOrigin } from '../../config.js';
import { buildSubscriptionPage } from '../subscription/subscription.page.js';
import {
  getSubscriptionSettings,
  invalidateSubscriptionSettingsCache,
} from './settings.service.js';

/**
 * When the certificate on that address runs out, or null when there is none
 * to read (plain http, or a handshake that never completed).
 *
 * Read with a bare TLS handshake rather than from the HTTP response: undici
 * does not hand back the peer certificate, and the operator's question here
 * ("is this going to expire on me") is worth its own five seconds.
 */
async function peerCertificateExpiry(url: string): Promise<string | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return null;
  return new Promise((resolve) => {
    const socket = tlsConnect(
      {
        host: parsed.hostname,
        port: Number(parsed.port || 443),
        servername: parsed.hostname,
        // A self-signed or mismatched certificate still has an expiry, and
        // saying when it runs out is more useful than refusing to look.
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const to = cert && typeof cert.valid_to === 'string' ? new Date(cert.valid_to) : null;
        resolve(to && !Number.isNaN(to.getTime()) ? to.toISOString() : null);
      },
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/**
 * Panel-wide settings (brand name, future feature flags). Two surfaces:
 *
 *   GET /api/settings/public: no auth, returns public-flagged keys
 *                                only. LoginPage fetches this before the
 *                                user authenticates so the page can show
 *                                the right brand.
 *
 *   GET /api/settings: requireAuth, returns ALL keys
 *   PUT /api/settings: requireAuth, upsert keys
 *
 * Keys we use today:
 *   - `brandName` (string, public): title shown on LoginPage + sidebar
 *   - `subscriptionProfileTitle` (string): Profile-Title header on /sub
 *                                                   (NULL → fall back to brandName)
 *   - `subscriptionUpdateIntervalHours` (number): Profile-Update-Interval header,
 *                                                   default 24
 *   - `subscriptionSupportUrl` (string): Support-URL header + announce
 *                                                   {{SUPPORT_URL}} placeholder
 *   - `subscriptionAnnounceTemplate` (string): Announce header template,
 *                                                   placeholders: {{TRAFFIC_LEFT}},
 *                                                   {{DAYS_LEFT}}, {{SUPPORT_URL}}
 *   - `subscriptionRoutingPreset` (enum, R1a + H2) - routing rules emitted into
 *                                                   clash/singbox/xrayjson:
 *                                                   'proxy-all' (default) |
 *                                                   'ru-split' | 'cn-split'
 *   - `subscriptionTlsFragment` (boolean)         - when true, the Xray JSON
 *                                                   format splits the client's
 *                                                   outgoing ClientHello via a
 *                                                   freedom `fragment` outbound
 *                                                   so SNI-based DPI cannot
 *                                                   cleanly match the handshake.
 *                                                   Default false. Xray JSON only.
 *
 * Future keys land in the same table; flip `isPublic` per key.
 */

const PUBLIC_KEYS = new Set(['brandName']);

const UpsertInput = z.object({
  brandName: z.string().min(1).max(64).optional(),
  subscriptionProfileTitle: z.string().min(1).max(128).nullable().optional(),
  subscriptionUpdateIntervalHours: z.number().int().min(1).max(168).optional(),
  subscriptionSupportUrl: z.string().url().max(255).nullable().optional(),
  subscriptionAnnounceTemplate: z.string().max(512).nullable().optional(),
  subscriptionRoutingPreset: z.enum(ROUTING_PRESET_IDS).optional(),
  // Entry pool cap. 0 = hand out every node the subscriber is entitled to,
  // which is the default and what an operator expects after deploying a
  // profile to a node. See SubscriptionSettings.entryPoolSize.
  subscriptionEntryPoolSize: z.number().int().min(0).max(64).optional(),
  // TLS-fragment - split the client's outgoing ClientHello so SNI-based DPI
  // (RU TSPU / RKN) cannot cleanly match the handshake. Xray JSON format only.
  subscriptionTlsFragment: z.boolean().optional(),
  // R3-b - raw custom xray routing rules (array of rule objects), or null to
  // clear. Applied to xray/xkeen subscription output ahead of the preset.
  subscriptionCustomRoutingRules: z
    .array(z.record(z.string(), z.unknown()))
    .max(50)
    .nullable()
    .optional(),
  // R3 - operator-defined custom domain lists (direct/proxy/block), or null to
  // clear. Emitted into xray/xkeen + clash routing rules ahead of the preset.
  subscriptionCustomDomainLists: z
    .object({
      direct: z.array(z.string().min(1).max(253)).max(500).optional(),
      proxy: z.array(z.string().min(1).max(253)).max(500).optional(),
      block: z.array(z.string().min(1).max(253)).max(500).optional(),
    })
    .nullable()
    .optional(),
  // Subscription landing-page default language. The panel's LanguageSwitcher
  // mirrors its UI language here so the human /sub page defaults to the same
  // language the operator runs the panel in. The page also carries an in-page
  // RU/EN selector (?lang=) that overrides per visitor, so this is the default,
  // not a hard lock.
  defaultLocale: z.enum(['ru', 'en']).optional(),
  // What the bare link hands a client that asked for nothing: no ?format=, no
  // user-agent rule, no JSON in Accept. Was hard-coded to `plain`.
  subscriptionDefaultFormat: z
    .enum(['plain', 'xrayjson', 'xrayjson-array', 'clash', 'singbox'])
    .optional(),
  // One line per server, or one line per server-and-protocol. See
  // SubscriptionSettings.linkShape for the collapsing rule.
  subscriptionLinkShape: z.enum(['per-node', 'per-exit']).optional(),
  // The operator's own wording for a subscription that is not in force. One
  // setting rather than six keys: they are written on one screen, saved by one
  // button and read together. An absent state, or an absent language inside
  // one, means the page's built-in text.
  subscriptionDeadTexts: z
    .object({
      expired: z.object({ ru: z.string().max(400), en: z.string().max(400) }).partial().optional(),
      limited: z.object({ ru: z.string().max(400), en: z.string().max(400) }).partial().optional(),
      disabled: z.object({ ru: z.string().max(400), en: z.string().max(400) }).partial().optional(),
    })
    .nullable()
    .optional(),
  // Host only, no scheme and no path: `nw.example.com`. A scheme is stripped
  // on read rather than rejected here, because an operator pasting a URL is
  // the expected mistake, not a malformed request.
  subscriptionPublicHost: z
    .string()
    .max(253)
    .regex(
      /^(https?:\/\/)?[a-z0-9.-]+(:\d{1,5})?$/i,
      'Host only, for example nw.example.com. No path, no trailing slash.',
    )
    .nullable()
    .optional(),
});

/**
 * Read-only values the delivery screen has to show and must not offer to edit.
 *
 * The path prefix is not writable, and not for lack of trying: the
 * subscription route is REGISTERED with it at boot
 * (`app.get(\`${config.SUBSCRIPTION_PATH_PREFIX}/:token\`)`), so a value from
 * the database would not move the route. It would only make the panel
 * advertise an address nothing answers on.
 *
 * `…Source` rather than an `…Editable` boolean, because a boolean reads as
 * "sometimes you may". It is never editable here; what changes is where the
 * value came from, and that is what the screen should say.
 */
const READ_ONLY_KEYS = {
  subscriptionPathPrefix: async () => config.SUBSCRIPTION_PATH_PREFIX,
  subscriptionPathPrefixSource: async () => 'env' as const,
  /**
   * How many live subscriptions the current address is serving.
   *
   * On the screen before the host is changed, not after: every one of these
   * people is holding a link built on the old host, and no redirect we control
   * can save them, because the old name may stop resolving to us at all.
   * A number makes that concrete in a way "this will break existing links"
   * never does.
   */
  subscriptionActiveCount: async () =>
    prisma.user.count({ where: { deletedAt: null, subRevokedAt: null, status: 'active' } }),
} as const;

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/public', async (_req, reply) => {
    const rows = await prisma.appSetting.findMany({
      where: { isPublic: true },
    });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return reply.send(out);
  });

  app.register(async (admin) => {
    admin.addHook('onRequest', requireAuth);

    admin.get('/api/settings', async (_req, reply) => {
      const rows = await prisma.appSetting.findMany();
      const out: Record<string, unknown> = {};
      /**
       * Every writable key is present, as null when nobody has set it.
       *
       * The read used to dump the rows that exist, so a key nobody had ever
       * saved was simply absent. The screen fell back to its defaults and
       * looked right, but "the operator never set this" and "the operator
       * cleared it" arrived as the same thing, and no screen can tell the
       * difference between a missing key and a missing answer.
       *
       * The list is taken from the schema that accepts writes rather than
       * written out again here: a second list would go stale the first time a
       * setting was added, and go stale invisibly, because a missing key looks
       * exactly like the state this is fixing.
       */
      for (const key of Object.keys(UpsertInput.shape)) out[key] = null;
      for (const r of rows) out[r.key] = r.value;
      // Values the screen must show and must not offer to edit. Emitted after
      // the rows so a stale hand-written row can never shadow the truth.
      for (const [key, read] of Object.entries(READ_ONLY_KEYS)) out[key] = await read();
      return reply.send(out);
    });

    admin.put('/api/settings', async (req, reply) => {
      const input = UpsertInput.parse(req.body);
      const entries = Object.entries(input).filter(([, v]) => v !== undefined);
      for (const [key, value] of entries) {
        // Prisma's `Json` column accepts any JSON-serialisable value at the
        // SQL layer, but the TS surface insists on `Prisma.InputJsonValue`.
        // Strings ARE valid JSON, so the cast is sound, TS just refuses
        // string→object without the explicit `unknown` step.
        const jsonValue = value as unknown as object;
        await prisma.appSetting.upsert({
          where: { key },
          create: { key, value: jsonValue, isPublic: PUBLIC_KEYS.has(key) },
          update: { value: jsonValue },
        });
      }
      // B5 - bust the /sub settings cache so admin changes take effect now.
      invalidateSubscriptionSettingsCache();
      return reply.send({ ok: true, updated: entries.map(([k]) => k) });
    });

    /**
     * Does the subscription address answer?
     *
     * ⚠ It answers THE PANEL. The request leaves this container, so it can
     * take an internal route where the outside world is firewalled off, and
     * a green result here is not proof that a subscriber can reach it. The
     * screen says "the address answers the panel" for exactly that reason:
     * the alternative is an operator with a closed 443 spending a day on a
     * green tick.
     */
    admin.post('/api/settings/subscription/probe', async (_req, reply) => {
      const settings = await getSubscriptionSettings();
      const origin = settings.publicHost
        ? `https://${settings.publicHost}`
        : subscriptionOrigin();
      // A token that cannot belong to anybody: the probe wants the transport
      // and the certificate, not somebody's subscription. A 404 from the app
      // is a perfectly good answer, it means the address reached us.
      const url = `${origin}${config.SUBSCRIPTION_PATH_PREFIX}/probe-${randomUUID()}`;
      const started = Date.now();
      const checkedAt = new Date().toISOString();
      try {
        const res = await request(url, {
          method: 'GET',
          headers: { 'user-agent': 'iceslab-panel-probe/1' },
          // A probe that hangs is a probe that tells the operator nothing.
          headersTimeout: 5000,
          bodyTimeout: 5000,
        });
        // Drain, or undici keeps the socket and the next probe queues behind it.
        await res.body.dump();
        return reply.send({
          // Anything the app answers means the address is ours and reachable.
          // 404 is the expected one for a token nobody owns.
          ok: res.statusCode < 500,
          status: res.statusCode,
          ms: Date.now() - started,
          tlsExpiresAt: await peerCertificateExpiry(url),
          checkedAt,
          url,
        });
      } catch (err) {
        return reply.send({
          ok: false,
          status: 0,
          ms: Date.now() - started,
          tlsExpiresAt: null,
          checkedAt,
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    /**
     * A URL the panel can drop into an iframe to show the real page.
     *
     * The token is random, lives fifteen minutes, and resolves to INVENTED
     * data. Never a live subscriber's: their link in an iframe means their
     * access in the browser history, in the referrer and in every proxy log
     * on the way. `?state=` picks which card to preview, which is the only
     * way to see the expired one without expiring somebody.
     */
    admin.get('/api/settings/subscription/preview-url', async (req, reply) => {
      const q = z
        .object({ state: z.enum(['active', 'expiring', 'expired', 'limited', 'disabled']).optional() })
        .parse(req.query);
      const token = randomUUID();
      await redis.set(
        `sub:preview:${token}`,
        JSON.stringify({ state: q.state ?? 'active' }),
        'EX',
        900,
      );
      return reply.send({
        url: `${config.PUBLIC_URL.replace(/\/$/, '')}/api/settings/subscription/preview/${token}`,
        expiresInSeconds: 900,
      });
    });
  });

  /**
   * The preview itself, public BY THE TOKEN and by nothing else.
   *
   * Outside the authenticated plugin on purpose: an iframe cannot attach the
   * panel's bearer token, so the URL has to carry its own proof. That proof is
   * a random uuid with a fifteen-minute life, and what it unlocks is a page
   * built from invented data, so leaking one costs nothing.
   */
  app.get('/api/settings/subscription/preview/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.params);
    const raw = await redis.get(`sub:preview:${token}`);
    if (!raw) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preview link expired' });
    }
    const { state } = JSON.parse(raw) as { state: string };
    const settings = await getSubscriptionSettings();
    const day = 86_400_000;
    const gib = 1024 ** 3;
    // Invented, and obviously so: the name says preview and the host is the
    // documentation domain. Nothing here reads the database.
    const html = buildSubscriptionPage({
      brandTitle: settings.profileTitle ?? settings.brandName ?? 'Iceslab',
      lang: settings.defaultLocale ?? 'ru',
      subUrl: `${subscriptionOrigin()}${config.SUBSCRIPTION_PATH_PREFIX}/preview-token`,
      supportUrl: settings.supportUrl,
      user: {
        username: 'preview',
        status: state === 'active' || state === 'expiring' ? 'active' : state,
        expireAt: new Date(Date.now() + (state === 'expiring' ? 3 : 82) * day).toISOString(),
        trafficLimitBytes: 200 * gib,
        trafficUsedBytes: (state === 'limited' ? 200 : 118) * gib,
      },
      protocols: state === 'active' || state === 'expiring' ? ['xray', 'hysteria', 'shadowsocks'] : [],
    });
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
