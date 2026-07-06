import { prisma } from '../../prisma.js';
import { config } from '../../config.js';

/**
 * Pick the effective ceiling on how many distinct device rows we're willing
 * to persist for one user. The per-user/squad `limit` is the admin's policy;
 * `systemMax` is an absolute backstop that applies even when there's no
 * per-user limit. Returns whichever is smaller (a null per-user limit means
 * "no policy limit", so the system backstop wins).
 *
 * Pure (no DB) so the ceiling decision is unit-testable without Postgres.
 */
export function effectiveDeviceCeiling(
  limit: number | null,
  systemMax: number,
): number {
  return limit === null ? systemMax : Math.min(limit, systemMax);
}

/**
 * Outcome of an HWID enforcement check on /sub/:token.
 *
 *   - `disabled`  — neither header nor user limit set; no enforcement run.
 *   - `allowed`   — device registered (upserted) and under quota.
 *   - `denied`    — device count exceeds user's limit. Caller emits 403.
 */
export interface HwidCheckResult {
  status: 'disabled' | 'allowed' | 'denied';
  /** Total devices currently registered for this user (after upsert). */
  active: number;
  /** Configured per-user limit. NULL → unlimited. */
  limit: number | null;
}

/**
 * Validate the `x-hwid` header for this subscription request, register
 * the device if new, and decide whether to allow the response.
 *
 * Trust model: HWID is client-supplied — admins use this to deter casual
 * subscription sharing, not adversarial users. A user determined to share
 * can spoof the header; that's accepted as a non-goal.
 *
 * Behaviour:
 *   - hwid is null/empty → no enforcement, no row written.
 *   - user.hwidDeviceLimit is null → audit-only: a device row is recorded so
 *     admins can see it, but only up to an absolute system ceiling
 *     (`HWID_MAX_DEVICES_PER_USER`) so a client-controlled `x-hwid` can't grow
 *     the table without bound. At the ceiling the request still succeeds; we
 *     just stop recording new devices.
 *   - device already exists → bump `lastSeenAt`, return `allowed`.
 *   - new device + count would exceed the effective ceiling
 *     (min of per-user limit and the system max) → return `denied` WITHOUT
 *     inserting the row (so re-trying with the same headers produces the
 *     same result and admins see the device that bumped the count, not
 *     blocked attempts).
 *
 * The hwid string is bounded to 255 chars upstream by the route handler;
 * here we trust it. UTF-8 collation is fine for the equality check.
 */
export async function enforceHwid(
  userId: string,
  hwid: string | null,
  limit: number | null,
): Promise<HwidCheckResult> {
  if (!hwid) {
    // No header → no enforcement, no row. Return `active=0` for the
    // X-Hwid-Active header — clients display it as "0/N".
    return { status: 'disabled', active: 0, limit };
  }

  // A known device is always just a `lastSeenAt` touch — no new row, so it
  // can't grow the table regardless of any ceiling. Fast-path it (one indexed
  // update on the unique key) before any counting.
  const existing = await prisma.hwidUserDevice.findUnique({
    where: { userId_hwid: { userId, hwid } },
  });

  if (existing) {
    await prisma.hwidUserDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    // For the unlimited (audit-only) path `active` stays cosmetic (0/unlimited);
    // otherwise report the real device count for the X-Hwid-Active gauge.
    const active = limit === null
      ? 0
      : await prisma.hwidUserDevice.count({ where: { userId } });
    return { status: 'allowed', active, limit };
  }

  // Brand-new device. Two concurrent /sub requests with different HWIDs could
  // both see `current < ceiling` and both insert, overshooting the cap by one.
  // Serialize per-user via a Postgres transaction-scoped advisory lock keyed on
  // a hash of userId; the lock auto-releases at tx end so unrelated users don't
  // block each other.
  //
  // The ceiling is `min(per-user limit, HWID_MAX_DEVICES_PER_USER)`. The system
  // backstop matters most on the `limit === null` path: `x-hwid` is a
  // client-controlled header with unbounded distinct values, so without a hard
  // cap one valid token could insert a never-pruned audit row per request until
  // the disk fills. Above the cap we skip the insert (audit-only for unlimited
  // users -> `allowed`; a real per-user limit -> `denied` so the client sees 403).
  const ceiling = effectiveDeviceCeiling(limit, config.HWID_MAX_DEVICES_PER_USER);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const current = await tx.hwidUserDevice.count({ where: { userId } });

    if (current >= ceiling) {
      // At the ceiling — DO NOT insert. A real per-user limit reports the
      // count and denies (403 upstream); the unlimited audit path just stops
      // growing the table and still lets the client through.
      if (limit === null) {
        return { status: 'allowed' as const, active: 0, limit: null };
      }
      return { status: 'denied' as const, active: current, limit };
    }

    await tx.hwidUserDevice.create({ data: { userId, hwid } });
    return {
      status: 'allowed' as const,
      active: limit === null ? 0 : current + 1,
      limit,
    };
  });
}

/**
 * K7 - reduce a user's per-squad HWID device-limit defaults to one effective
 * default. The MAX across the squads' positive values wins (most-permissive
 * cohort grants the device count); null when no squad sets one. Used only when
 * the user has no explicit hwidDeviceLimit. Pure (no DB) for testing.
 */
export function resolveSquadHwidLimit(squadDefaults: (number | null)[]): number | null {
  const vals = squadDefaults.filter((n): n is number => typeof n === 'number' && n > 0);
  return vals.length > 0 ? Math.max(...vals) : null;
}

/**
 * Admin-facing: list all devices currently registered for a user. Sorted
 * newest-first so the recently-added entry sits on top of the UI list.
 */
export async function listUserDevices(userId: string) {
  return prisma.hwidUserDevice.findMany({
    where: { userId },
    orderBy: [{ lastSeenAt: 'desc' }],
  });
}

/**
 * Admin-facing: revoke (delete) a single device row so the user can
 * register a different physical device on the next /sub/:token hit.
 */
export async function deleteDevice(id: string): Promise<void> {
  await prisma.hwidUserDevice.delete({ where: { id } });
}
