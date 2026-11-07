/**
 * 409 CONFLICT that names the field it hit (A-257 tail, BACK 6049eb10):
 * regions answer `field: 'name' | 'code'`, route policies `'name' | 'ordinal'`.
 * The refusal stands at that field in the server's words. The input is
 * checked first; a field this screen does not list, or an older server with no
 * `field`, is `null`, and the screen keeps saying it the way it did.
 */
export function conflictField<F extends string>(
  err: unknown,
  fields: readonly F[],
): { field: F; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 409 || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.error !== 'CONFLICT' || typeof d.field !== 'string' || !(fields as readonly string[]).includes(d.field)) return null;
  return { field: d.field as F, message: typeof d.message === 'string' ? d.message : '' };
}
