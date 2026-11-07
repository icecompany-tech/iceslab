import { formatGapGroups, hostFormatFacts, type FormatReason, type ProfileFormats } from '@/lib/old/formats';
import type { SubscriptionFormat } from '@iceslab/shared';
import { loadView } from '@/lib/old/loadView';

/**
 * The «will not get it» line of the xray profile form, from the server's
 * /api/profiles/:id/formats (the same answer the host chips read), not from a
 * table copied into the browser.
 *
 *   unsaved   no profile id yet: nothing to ask, the line says «-»;
 *   loading   the answer is on its way;
 *   unknown   the request failed, or the server is older than /formats
 *             (null): said as unknown, never as «everyone gets it»;
 *   none      every format carries the profile: no line;
 *   gaps      the formats left out, grouped by side (door, transport) and why.
 */
export type ProfileFormatsLine =
  | { kind: 'unsaved' | 'loading' | 'unknown' | 'none' }
  | { kind: 'gaps'; groups: { why: string; reason: FormatReason | null; formats: SubscriptionFormat[] }[] };

export function profileFormatsLine(
  profileId: string | null,
  q: { data: ProfileFormats | null | undefined; isError: boolean },
): ProfileFormatsLine {
  if (profileId === null) return { kind: 'unsaved' };
  // `null` is an answer (a server older than /formats), not «on its way».
  if (q.data === null) return { kind: 'unknown' };
  const view = loadView(q);
  if (view === 'loading') return { kind: 'loading' };
  if (view === 'failed' || !q.data) return { kind: 'unknown' };
  const groups = formatGapGroups(hostFormatFacts(q.data, []).rows);
  return groups.length === 0 ? { kind: 'none' } : { kind: 'gaps', groups };
}
