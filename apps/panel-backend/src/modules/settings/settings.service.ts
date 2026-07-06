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
