/**
 * The node's consumption multiplier and user ceiling (A-143, decision
 * 2026-10-22).
 *
 *   multiplier  how much traffic a user is charged per gigabyte through this
 *               node: a number from 0 to 100 with one decimal, 1 by default,
 *               0 makes the node free. Typed with a comma or a dot. A second
 *               decimal (1,25) is refused at the field, never rounded: a
 *               rounded charge is a different price than the one typed.
 *   maxUsers    empty is no ceiling, otherwise a whole number from 1.
 */

export const MULTIPLIER_MAX = 100;

export function parseMultiplier(input: string | number): { ok: true; value: number } | { ok: false } {
  const s = String(input).trim();
  if (s === '') return { ok: true, value: 1 };
  if (!/^\d{1,3}([.,]\d)?$/.test(s)) return { ok: false };
  const value = Number(s.replace(',', '.'));
  return value >= 0 && value <= MULTIPLIER_MAX ? { ok: true, value } : { ok: false };
}

export function parseMaxUsers(input: string | number): { ok: true; value: number | null } | { ok: false } {
  const s = String(input).trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const value = Number(s);
  return value >= 1 && Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
}

/**
 * Where the multiplier field stands (ARCH 23.10). On CREATE an empty field is
 * the default 1. On EDIT it is refused: clearing the field of a node at 0 or
 * 0,5 would silently make it 1, a paid node, so the operator says 1 in words.
 */
export function multiplierFieldError(input: string | number, editing: boolean): 'required' | 'bad' | null {
  if (editing && String(input).trim() === '') return 'required';
  return parseMultiplier(input).ok ? null : 'bad';
}

/** The body keys for a save: the parsed value, or nothing when the input does
 *  not parse or is empty on an edit (the form refuses both at the field
 *  first; this never sends a guess). */
export function multiplierPatch(input: string | number, editing = false): { consumptionMultiplier?: number } {
  if (multiplierFieldError(input, editing) !== null) return {};
  const r = parseMultiplier(input);
  return r.ok ? { consumptionMultiplier: r.value } : {};
}

export function maxUsersPatch(input: string | number): { maxUsers?: number | null } {
  const r = parseMaxUsers(input);
  return r.ok ? { maxUsers: r.value } : {};
}

/** The stored multiplier as the form shows it: «1», «0,5». A string from a
 *  server older than the numeric DTO is read the same way. */
export function multiplierInput(stored: unknown, decimalComma: boolean): string {
  const n = typeof stored === 'number' ? stored : typeof stored === 'string' ? Number(stored) : NaN;
  if (!Number.isFinite(n)) return '1';
  const s = String(Math.round(n * 10) / 10);
  return decimalComma ? s.replace('.', ',') : s;
}

/**
 * The card's badge: nothing at 1 (or when unknown), «free» at 0, «×N»
 * otherwise. Unknown is not 1 by accident: it says nothing, which is what 1
 * says too.
 */
export function multiplierBadge(stored: unknown): { kind: 'free' } | { kind: 'times'; value: number } | null {
  const n = typeof stored === 'number' ? stored : typeof stored === 'string' && stored.trim() !== '' ? Number(stored) : NaN;
  if (!Number.isFinite(n) || n === 1) return null;
  return n === 0 ? { kind: 'free' } : { kind: 'times', value: n };
}
