import type { User } from '@/lib/domain/users';

/**
 * Switching a user on and off (A-294): the drawer's access control and the
 * table's bulk enable / disable. Both were lost when the edit modal became the
 * drawer (31677a77), and an operator could no longer disable anyone from the
 * panel at all.
 */

export type AccessChoice = 'active' | 'disabled';

/** What the user is held to by the date and the quota, as the save would see them. */
export interface AccessFacts {
  expiresAt: Date | null;
  limitBytes: number | null;
  usedBytes: number;
}

/**
 * The status a save with this choice leaves the user in, as far as the drawer
 * can tell. Mirrors `statusAfterEdit` (panel-backend users.service.ts): the
 * server keeps `disabled` as said and lands `active` on the facts, so a date
 * still past stays expired and a spent quota stays limited. Switching such a
 * user on does not bring the subscription back; a later date, a higher quota
 * or a traffic reset does, and the drawer says that instead of promising it.
 * The facts are the form's, so an extension picked in the same save counts.
 */
export function accessOutcome(
  choice: AccessChoice,
  facts: AccessFacts,
  now: Date,
): 'active' | 'disabled' | 'expired' | 'limited' {
  if (choice === 'disabled') return 'disabled';
  if (facts.expiresAt && facts.expiresAt < now) return 'expired';
  if (facts.limitBytes !== null && facts.usedBytes >= facts.limitBytes) return 'limited';
  return 'active';
}

/**
 * The line under the access control, as an i18n key under `userDrawer`, or
 * null when the choice needs no words: a user being switched off is told what
 * stops, one held by the date or the quota is told what the switch cannot do.
 */
export function accessNoteKey(
  seed: AccessChoice,
  outcome: ReturnType<typeof accessOutcome>,
): 'accessDisableNote' | 'accessExpiredNote' | 'accessLimitedNote' | null {
  if (outcome === 'disabled') return seed === 'disabled' ? null : 'accessDisableNote';
  if (outcome === 'expired') return 'accessExpiredNote';
  if (outcome === 'limited') return 'accessLimitedNote';
  return null;
}

export type BulkAccessAction = 'enable' | 'disable';

/** POST /api/users/bulk as the screen reads it. */
export interface BulkReport {
  requested: number;
  succeeded: number;
  /** Ids the action did reach. */
  ok: string[];
  /** Per user, the server's own words. */
  failed: { userId: string; error: string }[];
}

/**
 * The bulk answer, checked before it is taken: anything that is not the
 * report (null, a string, another shape) is null, and the screen says it could
 * not read the answer rather than counting zeros.
 */
export function bulkReport(data: unknown): BulkReport | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.requested !== 'number' || typeof d.succeeded !== 'number') return null;
  if (!Array.isArray(d.ok) || !Array.isArray(d.failed)) return null;
  const ok = d.ok.filter((x): x is string => typeof x === 'string');
  const failed = d.failed.flatMap((f) => {
    const r = f && typeof f === 'object' ? (f as Record<string, unknown>) : null;
    return r && typeof r.userId === 'string' ? [{ userId: r.userId, error: typeof r.error === 'string' ? r.error : '' }] : [];
  });
  return { requested: d.requested, succeeded: d.succeeded, ok, failed };
}

/** The facts of a stored user, for a drawer that has not touched date or quota. */
export function storedAccessFacts(user: Pick<User, 'expireAt' | 'trafficLimitBytes' | 'trafficUsedBytes'>): AccessFacts {
  return {
    expiresAt: user.expireAt ? new Date(user.expireAt) : null,
    limitBytes: user.trafficLimitBytes,
    usedBytes: user.trafficUsedBytes,
  };
}
