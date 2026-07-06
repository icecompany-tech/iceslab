import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Public Hysteria UDP port advertised in subscription URIs. Different from
  // the panel↔node control-plane port stored in `nodes.address`. Slice 23
  // (inbounds CRUD) will replace this with per-inbound config.
  HYSTERIA_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(443),

  // Public Xray VLESS+REALITY port advertised in subscription URIs.
  XRAY_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(443),

  // REALITY parameters mirror what's set on every node-agent's xray inbound.
  // All three must be present for the panel to emit `vless://` endpoints; any
  // missing → user's enabledProtocols=['xray'] yields no endpoints. Slice 23
  // moves these into the inbounds table per node.
  XRAY_REALITY_PUBLIC_KEY: z.string().optional(),
  XRAY_REALITY_SHORT_ID: z.string().regex(/^[0-9a-fA-F]{0,16}$/, 'hex up to 16 chars').optional(),
  XRAY_REALITY_SNI: z.string().optional(),
  XRAY_FLOW: z.string().default('xtls-rprx-vision'),
  XRAY_FINGERPRINT: z.string().default('chrome'),

  // Comma-separated list of frontend origins allowed to call the API.
  // Default covers the Vite dev server.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Public-facing base URL of this panel (e.g. https://panel.example.com).
  // REQUIRED: used to generate bootstrap install commands, subscription
  // links, AND the panelUrl baked into node payloads (slice 38 heartbeat).
  // Letting it be optional silently broke heartbeat self-destruct because
  // agents shipped with `panelUrl=undefined` and never polled, the
  // mechanism that was supposed to revoke a stolen bundle just sat dead.
  PUBLIC_URL: z.url(),

  // Path prefix where the subscription endpoint is mounted. Default
  // `/sub` matches the historical default. Operators with concerns
  // about Iceslab fingerprinting can change it (e.g. `/v` or `/get`)
  // - the backend reads this when registering the subscription route,
  // and `/api/auth/status` surfaces it to the SPA so admin sees the
  // correct full URL when copy-pasting a user's subscription link.
  // Always starts with `/`, no trailing slash.
  SUBSCRIPTION_PATH_PREFIX: z
    .string()
    .regex(/^\/[a-zA-Z0-9_-]+$/, 'Must start with / and use only [a-zA-Z0-9_-]')
    .default('/sub'),

  // Number of trusted reverse-proxy hops in front of the backend. Zero
  // (default) → request.ip is the immediate socket peer; X-Forwarded-For
  // is ignored. Production behind Caddy + Cloudflare uses 2. Don't bump
  // this above the actual hop count or any client can spoof X-Forwarded-
  // For and bypass per-IP rate limits.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),

  // Per-route rate-limit knobs, tunable per deployment. Defaults are
  // tuned for a small panel; raise on busy multi-thousand-user instances.
  RATE_LIMIT_SUB_PER_MIN: z.coerce.number().int().min(1).default(30),
  // Secondary IP-only ceiling for the subscription endpoint, applied in
  // addition to the per-(ip,token) bucket. The per-token bucket lets an
  // attacker rotate tokens to get a fresh 30/min on each, this catches
  // token rotation by capping total /sub hits per IP. Tune above legit
  // shared-CGNAT polling: e.g. 200 users on one CGNAT NAT at 24h refresh
  // ~= 0.14/min. 120/min is ~1000x that, well clear of legit traffic.
  RATE_LIMIT_SUB_IP_PER_MIN: z.coerce.number().int().min(1).default(120),

  // Default OFF for alpha: admin-login activity is operational PII and
  // shouldn't auto-ship to a third-party chat. Set =true (and configure
  // TELEGRAM_BOT_TOKEN/CHAT_ID) only if the operator explicitly wants
  // login/lockout alerts. IPs in those alerts are now /24-redacted.
  TELEGRAM_NOTIFY_LOGIN_EVENTS: z
    .string()
    .default('false')
    .transform((s) => s.toLowerCase() === 'true' || s === '1'),
  RATE_LIMIT_BOOTSTRAP_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_HEARTBEAT_PER_MIN: z.coerce.number().int().min(1).default(120),

  // Absolute ceiling on distinct HWID device rows recorded per user, applied
  // even to users with no per-user/squad device limit (the common case, where
  // /sub still upserts one audit row per distinct x-hwid header). The header
  // is client-controlled and unbounded in distinct values, so without a hard
  // cap a single valid token can grow hwid_user_devices one never-pruned row
  // at a time until the disk fills. 1000 is far above any real device count.
  HWID_MAX_DEVICES_PER_USER: z.coerce.number().int().min(1).default(1000),

  // K2: outbound webhook bus. Domain events (user / profile / binding / node
  // lifecycle) are POSTed as signed JSON to these URLs so third parties
  // (billing bots, dashboards, CRMs) can react without polling. This is how an
  // ecosystem grows on top of the panel without us building billing ourselves.
  // Comma-separated URL list; empty = disabled.
  WEBHOOK_URLS: z
    .string()
    .optional()
    .transform((v) =>
      v && v.trim()
        ? v
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean)
        : [],
    ),
  // HMAC-SHA256 secret signing each body (X-Iceslab-Signature header over
  // `${timestamp}.${body}`) so receivers can verify authenticity + reject
  // replays via the timestamp. Optional; unsigned if unset (dev only).
  WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Slice S7: public IP of the panel, baked into the node-install
  // command as `--panel-ip`. Causes the agent's UFW to allow :1337/tcp
  // ONLY from this IP. CRITICAL: must be the panel's *origin* IP, not
  // a Cloudflare edge IP. Optional, without it the install command
  // shows a `--panel-ip <YOUR_IP>` placeholder and admin fills manually.
  // Loose validation: any non-empty token. Operator controls this, no
  // injection vector, UFW will reject malformed IPs at allow-time.
  PANEL_PUBLIC_IP: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Slice S7: login bruteforce defence. After this many failed logins
  // for the same username (case-insensitive) within the window, lock the
  // account for LOCKOUT_DURATION_MIN minutes regardless of source IP.
  // Per-IP rate limit is separate (faster, lower threshold).
  LOGIN_LOCKOUT_FAILURES: z.coerce.number().int().min(1).default(10),
  LOGIN_LOCKOUT_DURATION_MIN: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_WINDOW_MIN: z.coerce.number().int().min(1).default(10),

  // ACME contact email used by node-installers that need a Let's Encrypt
  // cert (Hysteria 2 / NaiveProxy / Caddy). Optional, install command
  // emits a placeholder when unset, admin fills manually.
  //
  // We coerce empty-string → undefined BEFORE the .email() check because
  // install-iceslab.sh emits `ACME_DEFAULT_EMAIL=` (no value) into the
  // generated .env.production as a "fill me in later" hint, and Zod's
  // bare `.email().optional()` rejects "" as an invalid email rather than
  // treating it as absent. Same pattern as PANEL_PUBLIC_IP / TELEGRAM_*.
  ACME_DEFAULT_EMAIL: z
    .preprocess((v) => (v === '' ? undefined : v), z.email().optional()),

  // Tier-1 security: Telegram alert webhook (cycle #5 SECURITY.md).
  // When BOT_TOKEN + CHAT_ID are both set, the panel pushes notifications
  // for high-signal security events:
  //   - admin login success / lockout / failed lockout
  //   - node self-destruct trigger
  //   - node bootstrap token issued
  // Optional, when either is unset, calls to `notifyTelegram` are no-ops.
  // Get a bot token from @BotFather; chat_id from @userinfobot.
  TELEGRAM_BOT_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  TELEGRAM_CHAT_ID: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Tier-1 security: admin geo-block. CSV list of ISO 3166-1 alpha-2
  // country codes allowed on `/api/*` routes EXCEPT the public-by-design
  // ones (subscription, heartbeat, bootstrap). Empty → disabled (any
  // country allowed). The country is read from `CF-IPCountry` (Cloudflare
  // edge header) and falls back to `X-Country-Code` if a non-Cloudflare
  // front-edge wants to opt in. When the header is missing entirely on a
  // gated request we DENY (fail-closed). Cloudflare orange-cloud is a
  // hard prerequisite for this control.
  ADMIN_ALLOWED_COUNTRIES: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => /^[A-Z]{2}$/.test(s))
        : [],
    ),

  // Tier-1 security: honey-route blacklist TTL (seconds). When an IP
  // hits a known scanner path (/wp-admin, /.env, ...), we surface a
  // plausible fake response AND add the IP to `sec:blacklist:<ip>` in
  // Redis for this duration. Subsequent requests from that IP get a
  // fast 403 before any business logic runs. 3600s = 1h is a reasonable
  // default, long enough to wear a scanner down, short enough that a
  // legit user on a shared-NAT egress isn't permanently shut out.
  HONEYPOT_BLACKLIST_TTL_SEC: z.coerce.number().int().min(60).default(3600),

  // Tier-1 security: honey subscription tokens. CSV of tokens admin
  // deliberately places in suspicious channels (pastebins, screenshots,
  // semi-public Telegram chats) as a leak tripwire. ANY hit on
  // `/sub/<honey>` fires a Telegram alert with source IP + UA + path,
  // returns a plausible empty subscription, and blacklists the source
  // IP for HONEYPOT_BLACKLIST_TTL_SEC. The token never matches a real
  // user. Empty list → feature disabled.
  HONEY_USER_TOKENS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length >= 8 && s.length <= 128)
        : [],
    ),
});

export type Config = z.infer<typeof ConfigSchema>;

// The JWT_SECRET shipped in .env.test (committed so CI / contributors can
// run vitest without provisioning their own). It MUST never reach a
// non-test environment, if it did, every JWT signed by the running panel
// would be forgeable by anyone who's ever cloned the repo. Guard at boot.
const TEST_JWT_SECRET = 'test_secret_at_least_32_characters_long_for_zod_validation';

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
  }
  if (parsed.data.NODE_ENV !== 'test' && parsed.data.JWT_SECRET === TEST_JWT_SECRET) {
    console.error(
      '❌ JWT_SECRET matches the public .env.test fixture in NODE_ENV=' +
        parsed.data.NODE_ENV +
        '. Refuse to boot: replace JWT_SECRET in your .env(.production) with a fresh random secret.',
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config: Config = Object.freeze(loadConfig());
