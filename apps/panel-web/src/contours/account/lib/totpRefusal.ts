/**
 * A wrong code on enable or disable of 2FA (A-169): the server answers
 * 400 INVALID_TOTP (bda3e3b9; it was 401 and the panel signed the admin out
 * for a typo). The card says it at the code field, not in a toast, so the
 * admin sees which input to fix. Anything else (409 already on, network,
 * 5xx) is false and stays a toast.
 *
 * The words are the panel's, not the server's: its sentence is English
 * («Invalid 2FA code») and carries nothing the screen does not know.
 */
export function isTotpRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return false;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 400 || !data || typeof data !== 'object') return false;
  return (data as { error?: unknown }).error === 'INVALID_TOTP';
}
