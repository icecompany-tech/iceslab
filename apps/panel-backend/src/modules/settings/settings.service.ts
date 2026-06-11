import { isRoutingPresetId, type RoutingPresetId } from '@iceslab/shared';
import { prisma } from '../../prisma.js';

/**
 * Resolved subscription-related settings. Read by `/sub/:token` to set
 * Profile-Title / Profile-Update-Interval / Support-URL / Announce headers
 * client apps (Hiddify, Streisand, V2RayNG, Happ, NekoBox) consume.
 *
 * All fields are nullable except `updateIntervalHours` which always has a
 * sensible default — the headers we emit are themselves optional, so a NULL
 * value just means "do not emit this header".
 */
export interface SubscriptionSettings {
  profileTitle: string | null;
  updateIntervalHours: number;
  supportUrl: string | null;
  announceTemplate: string | null;
  brandName: string | null;
  routingPreset: RoutingPresetId;
}

/**
 * Pull all settings rows once and project the subset the subscription
 * pipeline cares about. Cached at the call-site if needed (we only read
 * once per /sub/:token request).
 */
export async function getSubscriptionSettings(): Promise<SubscriptionSettings> {
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

  return {
    profileTitle: asString('subscriptionProfileTitle'),
    updateIntervalHours: asInt('subscriptionUpdateIntervalHours', 24),
    supportUrl: asString('subscriptionSupportUrl'),
    announceTemplate: asString('subscriptionAnnounceTemplate'),
    brandName: asString('brandName'),
    routingPreset: isRoutingPresetId(routingRaw) ? routingRaw : 'proxy-all',
  };
}

/**
 * Render an announce template substituting `{{TRAFFIC_LEFT}}`,
 * `{{DAYS_LEFT}}`, `{{SUPPORT_URL}}`. Empty/null template → empty string.
 *
 * Placeholders that resolve to NULL/undefined become an empty string
 * rather than the literal `{{X}}` — so a template like
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
