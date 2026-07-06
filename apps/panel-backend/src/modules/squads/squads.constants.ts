/**
 * Stable, well-known UUID for the "All" squad. Seeded by the
 * `20260507180000_seed_all_squad` migration; referenced by app code without
 * a query.
 *
 * Why a constant UUID rather than a "name=All" lookup: cheap, refactor-safe,
 * lets us flag the row as system-owned in the UI ("All" is read-only for
 * humans, admins can't rename or delete it because user-creation always
 * falls back here when no explicit groups are chosen).
 */
export const ALL_SQUAD_ID = '00000000-0000-0000-0000-000000000001';

/** Display name shown in panel UI; matches the seeded row's `name` column. */
export const ALL_SQUAD_NAME = 'All';
