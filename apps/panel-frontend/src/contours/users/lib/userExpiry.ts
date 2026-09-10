/**
 * How long a subscription is bought for.
 *
 * The panel stores a date, never a span, so every entry here is just a far
 * date: "100 years" stays a real expiry an operator can shorten later, and
 * only "never" stores nothing at all. The operator picks the words, the form
 * shows the day they land on, and both sides of the API get the same day.
 */
export type ExpirySpan = 'd7' | 'd30' | 'd90' | 'y1' | 'y5' | 'y100' | 'never';

/** Order as drawn, shortest first, "no expiry" last. */
export const EXPIRY_SPANS: ExpirySpan[] = ['d7', 'd30', 'd90', 'y1', 'y5', 'y100', 'never'];

/**
 * Calendar arithmetic, not multiplication. A hundred years counted as 365-day
 * blocks lands almost a month short of the same date, and the operator would
 * read a year that does not match the words next to it.
 */
export function expiryDate(span: ExpirySpan, from: Date): Date | null {
  if (span === 'never') return null;
  const at = new Date(from);
  if (span === 'd7') at.setDate(at.getDate() + 7);
  else if (span === 'd30') at.setDate(at.getDate() + 30);
  else if (span === 'd90') at.setDate(at.getDate() + 90);
  else if (span === 'y1') at.setFullYear(at.getFullYear() + 1);
  else if (span === 'y5') at.setFullYear(at.getFullYear() + 5);
  else at.setFullYear(at.getFullYear() + 100);
  return at;
}

/**
 * Create takes a day count, edit takes a date. Both are derived from the same
 * chosen day so the two paths cannot drift apart. Empty means no expiry, the
 * same empty the form already used for "unlimited".
 */
export function expiryDays(span: ExpirySpan, from: Date): number | '' {
  const at = expiryDate(span, from);
  return at === null ? '' : Math.round((at.getTime() - from.getTime()) / 86_400_000);
}

/**
 * The span a stored day count belongs to, if any. A preset carrying 45 days
 * has no span: it is shown as its own number rather than rounded into one.
 */
export function spanOfDays(days: number | '', from: Date): ExpirySpan | null {
  if (days === '') return 'never';
  return EXPIRY_SPANS.find((s) => expiryDays(s, from) === days) ?? null;
}

/** "4 Aug 2126". Same locale the preview card already prints dates in. */
export function formatExpiryDate(at: Date): string {
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
