import type { TFn } from '@/lib/ui/relativeTime';
export function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function trafficPercent(used: number, limit: number | null): number | null {
  if (limit === null || limit === 0) return null;
  return Math.min(100, (used / limit) * 100);
}

// Counts DOWN, unlike relativeTime next to it, so it keeps rounding: flooring
// would turn "expires in 20 hours" into "in 0 days", which is worse than being
// approximate. Different question, different rule.
export function expireRelative(
  iso: string | null,
  t: TFn,
): { text: string; tone: 'good' | 'warn' | 'bad' | 'never' } {
  if (!iso) return { text: t('userTime.noExpiry'), tone: 'never' };
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: t('userTime.expiredAgo', { days: -days }), tone: 'bad' };
  if (days === 0) return { text: t('userTime.expiresToday'), tone: 'bad' };
  if (days <= 7) return { text: t('userTime.daysLeft', { days }), tone: 'warn' };
  return { text: t('userTime.daysLeft', { days }), tone: 'good' };
}

// ───── Table shape ─────

/**
 * Column widths, in px. Username is the only elastic one, everything to its
 * right is fixed so the lanes line up across every row on the page.
 */
