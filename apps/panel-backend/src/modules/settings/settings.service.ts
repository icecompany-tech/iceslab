import { isRoutingPresetId, type RoutingPresetId } from '@iceslab/shared';
import { prisma } from '../../prisma.js';

/**
 * Resolved subscription-related settings. Read by `/sub/:token` to set
 * Profile-Title / Profile-Update-Interval / Support-URL / Announce headers
 * client apps (Hiddify, Streisand, V2RayNG, Happ, NekoBox) consume.
 *
 * All fields are nullable except `updateIntervalHours` which always has a
 * sensible default, the headers we emit are themselves optional, so a NULL
 * value just means "do not emit this header".
 */
export interface SubscriptionSettings {
  profileTitle: string | null;
  updateIntervalHours: number;
  supportUrl: string | null;
  announceTemplate: string | null;
  brandName: string | null;
  routingPreset: RoutingPresetId;
  /** TLS-fragment - split the ClientHello via a freedom `fragment` outbound in
   *  the Xray JSON format so SNI-DPI cannot match the handshake. Xray JSON only. */
  tlsFragment: boolean;
  /** R3-b - raw custom xray routing rules, or null. Applied to xray/xkeen. */
  customRoutingRules: Record<string, unknown>[] | null;
  /** R3 - operator-defined custom domain lists (direct/proxy/block), or null
   *  when every bucket is empty. Emitted into xray/xkeen + clash routing rules. */
  customDomainLists: { direct: string[]; proxy: string[]; block: string[] } | null;
  /** Subscription landing-page default language, mirrored from the panel's UI
   *  language. NULL = fall back to the visitor's Accept-Language. The /sub page
   *  has an in-page RU/EN selector (?lang=) that overrides this per visitor. */
  defaultLocale: 'ru' | 'en' | null;
  /**
   * How many interchangeable entry nodes one profile hands a subscriber.
   *
   * 0 (the default) hands out every node the subscriber is entitled to. That is
   * what an operator expects when they deploy a profile to a node: it should
   * show up in subscriptions, full stop. Anything else looks like the node
   * silently broke, which is exactly how this surfaced.
   *
   * A positive value caps it, picking that many per profile by rendezvous hash
   * (stable per person, only the fallen node's users get reshuffled). The
   * trade-off it buys: a leaked subscription then exposes a slice of the entry
   * surface instead of all of it. Worth having, not worth defaulting to.
   */
  entryPoolSize: number;
  /**
   * What a client gets from the bare link when it asks for nothing in
   * particular: no `?format=`, no user-agent rule, no JSON in Accept.
   *
   * Was hard-coded to `plain` (the base64 URI list), which is the safe answer
   * because every client can read it. An operator whose subscribers are all on
   * one app can do better than the lowest common denominator, and this is
   * where they say so.
   */
  defaultFormat: 'plain' | 'xrayjson' | 'xrayjson-array' | 'clash' | 'singbox';
  /**
   * One line per SERVER or one line per server-and-protocol.
   *
   * `per-exit` is what the panel has always done: a line per binding, so a
   * node serving vless and hy2 appears twice. `per-node` collapses those to
   * the one line the operator would have picked, by protocol preference and
   * then by the lower port. Nothing is lost by collapsing: every protocol is
   * still downloadable from the page's config block.
   */
  linkShape: 'per-node' | 'per-exit';
  /**
   * Operator's own wording for a subscription that is not in force, per state
   * and per language. Absent, or an absent language inside it, means the
   * page's built-in text.
   *
   * One setting rather than six keys because they are written on one screen,
   * saved by one button and read together.
   */
  deadTexts: {
    expired?: { ru?: string; en?: string };
    limited?: { ru?: string; en?: string };
    disabled?: { ru?: string; en?: string };
  } | null;
  /**
   * The host subscription links are built on, without a scheme
   * (`nw.example.com`), or null to use SUBSCRIPTION_PUBLIC_URL / PUBLIC_URL.
   *
   * Settable from the panel because it only affects strings we PRINT. Its
   * neighbour, the path prefix, is not: the route is registered with it at
   * boot, so a value from the database would not move the route, it would
   * only make the panel advertise an address nothing answers on.
   */
  publicHost: string | null;
}

// B5 - in-process cache for the subscription settings. `/sub/:token` is hit on
// every client poll (every few minutes per device) and each call read the WHOLE
// app_settings table. Settings change rarely and only via PUT /api/settings, so
// cache the projected DTO for a short TTL and bust it on write
// (invalidateSubscriptionSettingsCache) for instant admin feedback.
const SETTINGS_CACHE_TTL_MS = 60_000;
let settingsCache: { value: SubscriptionSettings; expiresAt: number } | null = null;

/** Clear the subscription-settings cache. Call after any settings write. */
export function invalidateSubscriptionSettingsCache(): void {
  settingsCache = null;
}

/**
 * Pull all settings rows once and project the subset the subscription
 * pipeline cares about. Cached in-process (B5) with a short TTL + write-bust.
 */
export async function getSubscriptionSettings(): Promise<SubscriptionSettings> {
  if (settingsCache && Date.now() < settingsCache.expiresAt) {
    return settingsCache.value;
  }
  const rows = await prisma.appSetting.findMany();
  const map = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));

  const asString = (k: string): string | null => {
    const v = map.get(k);
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const asInt = (k: string, fallback: number): number => {
    const v = map.get(k);
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    return fallback;
  };

  // Routing Templates (R1a). Unknown / missing values fall back to
  // 'proxy-all' (legacy behaviour) so a hand-edited row can never break /sub.
  const routingRaw = map.get('subscriptionRoutingPreset');

  // TLS-fragment. Only the literal boolean true turns it on; missing / garbage
  // rows fall back to false, keeping the Xray JSON output byte-identical.
  const tlsFragment = map.get('subscriptionTlsFragment') === true;

  // R3-b - custom xray routing rules. Must be an array of objects, else null
  // so a hand-edited / malformed row can never break /sub.
  const customRaw = map.get('subscriptionCustomRoutingRules');
  const customRoutingRules =
    Array.isArray(customRaw) && customRaw.every((r) => r !== null && typeof r === 'object')
      ? (customRaw as Record<string, unknown>[])
      : null;

  // R3 - custom domain lists. Defensive parse: a non-object / malformed row
  // yields null so the build path stays untouched (byte-identical). Only kept
  // when at least one bucket holds >=1 non-empty string.
  const cdlRaw = map.get('subscriptionCustomDomainLists');
  const cdl =
    cdlRaw && typeof cdlRaw === 'object' && !Array.isArray(cdlRaw)
      ? (cdlRaw as Record<string, unknown>)
      : null;
  const asDomainArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
  const customDomainLists = cdl
    ? (() => {
        const lists = {
          direct: asDomainArr(cdl.direct),
          proxy: asDomainArr(cdl.proxy),
          block: asDomainArr(cdl.block),
        };
        return lists.direct.length + lists.proxy.length + lists.block.length > 0 ? lists : null;
      })()
    : null;

  // Subscription page default language. Only the two known locales are honoured;
  // a missing / hand-edited garbage row yields null so /sub falls back to the
  // visitor's Accept-Language (legacy behaviour).
  const localeRaw = asString('defaultLocale');
  const defaultLocale = localeRaw === 'ru' || localeRaw === 'en' ? localeRaw : null;

  // Every read below is defensive for the same reason the rest of this
  // function is: app_settings is a jsonb key-value table, a row can be
  // hand-edited, and a garbage value must fall back to the old behaviour
  // rather than change what subscribers get.
  const FORMATS = ['plain', 'xrayjson', 'xrayjson-array', 'clash', 'singbox'] as const;
  const fmtRaw = map.get('subscriptionDefaultFormat');
  const defaultFormat = FORMATS.includes(fmtRaw as (typeof FORMATS)[number])
    ? (fmtRaw as (typeof FORMATS)[number])
    : 'plain';

  const shapeRaw = map.get('subscriptionLinkShape');
  const linkShape = shapeRaw === 'per-node' ? 'per-node' : 'per-exit';

  // Only the three known states, only the two known languages, only non-empty
  // strings. An empty object collapses to null so the page keeps its own text
  // instead of rendering blanks.
  const deadRaw = map.get('subscriptionDeadTexts');
  const deadTexts = (() => {
    if (!deadRaw || typeof deadRaw !== 'object' || Array.isArray(deadRaw)) return null;
    const src = deadRaw as Record<string, unknown>;
    const out: NonNullable<SubscriptionSettings['deadTexts']> = {};
    for (const state of ['expired', 'limited', 'disabled'] as const) {
      const v = src[state];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const rec = v as Record<string, unknown>;
      const pair: { ru?: string; en?: string } = {};
      for (const lang of ['ru', 'en'] as const) {
        const s = rec[lang];
        if (typeof s === 'string' && s.trim().length > 0) pair[lang] = s;
      }
      if (pair.ru || pair.en) out[state] = pair;
    }
    return Object.keys(out).length > 0 ? out : null;
  })();

  const value: SubscriptionSettings = {
    profileTitle: asString('subscriptionProfileTitle'),
    updateIntervalHours: asInt('subscriptionUpdateIntervalHours', 24),
    supportUrl: asString('subscriptionSupportUrl'),
    announceTemplate: asString('subscriptionAnnounceTemplate'),
    brandName: asString('brandName'),
    routingPreset: isRoutingPresetId(routingRaw) ? routingRaw : 'proxy-all',
    tlsFragment,
    customRoutingRules,
    customDomainLists,
    defaultLocale,
    // Negative or garbage reads as "no cap": the failure mode of a bad row must
    // be a subscriber seeing everything, never a subscriber seeing nothing.
    entryPoolSize: Math.max(0, asInt('subscriptionEntryPoolSize', 0)),
    defaultFormat,
    linkShape,
    deadTexts,
    // Stored without a scheme, and the one thing worth rejecting here is a
    // value carrying one: `https://host` would concatenate into
    // `https://https://host`.
    publicHost: asString('subscriptionPublicHost')?.replace(/^https?:\/\//, '') ?? null,
  };
  settingsCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return value;
}

/**
 * Render an announce template substituting `{{TRAFFIC_LEFT}}`,
 * `{{DAYS_LEFT}}`, `{{SUPPORT_URL}}`. Empty/null template → empty string.
 *
 * Placeholders that resolve to NULL/undefined become an empty string
 * rather than the literal `{{X}}`, so a template like
 * `"Осталось {{DAYS_LEFT}} дней"` for an unlimited user reads
 * `"Осталось  дней"` (admin's problem to template around it).
 */
export function renderAnnounce(
  template: string | null,
  vars: {
    trafficLeft: string;
    daysLeft: string;
    supportUrl: string;
  },
): string {
  if (!template) return '';
  return template
    .replaceAll('{{TRAFFIC_LEFT}}', vars.trafficLeft)
    .replaceAll('{{DAYS_LEFT}}', vars.daysLeft)
    .replaceAll('{{SUPPORT_URL}}', vars.supportUrl);
}

/**
 * Format a byte count as the closest human unit (KiB / MiB / GiB / TiB).
 * Used for `{{TRAFFIC_LEFT}}` substitution. Returns "∞" for null
 * (unlimited subscription).
 */
export function formatBytes(bytes: bigint | null): string {
  if (bytes === null) return '∞';
  const n = Number(bytes);
  if (n < 0) return '0';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
