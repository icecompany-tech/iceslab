/**
 * The admin's own password change (A-039, PUT /api/auth/password).
 *
 * The form checks what the server checks first, so a typo costs no try against
 * the sign-in lock: the new password by the register rule (8 to 128, the
 * server's CreateAdminSchema; not in shared), the repeat, a new one equal to
 * the current, and the 2FA code when 2FA is on.
 *
 * The server's refusals land on the field they are about. They are 403 and
 * 429, never 401: a 401 is the end of the session for the panel, and a wrong
 * current password must not throw the admin out mid-typing.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export interface PasswordForm {
  current: string;
  next: string;
  repeat: string;
  totp: string;
}

export type PasswordField = keyof PasswordForm | 'form';

export type PasswordProblem =
  | 'required'
  | 'short'
  | 'long'
  | 'same'
  | 'mismatch'
  | 'totpFormat'
  | 'wrongCurrent'
  | 'weak'
  | 'totpRequired'
  | 'totpWrong'
  | 'locked';

/** What the form refuses before the request, by field. */
export function passwordFormProblems(v: PasswordForm, twofaOn: boolean): Partial<Record<PasswordField, PasswordProblem>> {
  const out: Partial<Record<PasswordField, PasswordProblem>> = {};
  if (!v.current) out.current = 'required';
  if (v.next.length < PASSWORD_MIN) out.next = 'short';
  else if (v.next.length > PASSWORD_MAX) out.next = 'long';
  else if (v.current && v.next === v.current) out.next = 'same';
  if (v.repeat !== v.next) out.repeat = 'mismatch';
  if (twofaOn && !/^\d{6}$/.test(v.totp)) out.totp = 'totpFormat';
  return out;
}

/** The body of the request: the code only when 2FA is on. */
export function passwordBody(v: PasswordForm, twofaOn: boolean): {
  currentPassword: string;
  newPassword: string;
  totpCode?: string;
} {
  return { currentPassword: v.current, newPassword: v.next, ...(twofaOn ? { totpCode: v.totp } : {}) };
}

export interface PasswordRefusal {
  field: PasswordField;
  problem: PasswordProblem;
  /** ACCOUNT_LOCKED: how long the lock holds, when the server says. */
  retryAfterSeconds?: number;
}

/**
 * The server's refusal, on its field. The input is checked first; null means
 * not one of these, said by the caller in the server's words.
 */
export function passwordRefusal(err: unknown): PasswordRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; retryAfterSeconds?: unknown };
  switch (`${String(res.status)} ${String(d.error)}`) {
    case '403 INVALID_CURRENT_PASSWORD':
      return { field: 'current', problem: 'wrongCurrent' };
    case '400 PASSWORD_UNCHANGED':
      return { field: 'next', problem: 'same' };
    case '400 VALIDATION_ERROR':
      return { field: 'next', problem: 'weak' };
    case '403 TOTP_REQUIRED':
      return { field: 'totp', problem: 'totpRequired' };
    case '403 INVALID_TOTP':
      return { field: 'totp', problem: 'totpWrong' };
    case '429 ACCOUNT_LOCKED':
      return {
        field: 'form',
        problem: 'locked',
        ...(typeof d.retryAfterSeconds === 'number' && d.retryAfterSeconds > 0 ? { retryAfterSeconds: d.retryAfterSeconds } : {}),
      };
    default:
      return null;
  }
}

/** One key per problem; the test holds every one to both locales. */
export const PASSWORD_PROBLEM_KEY: Record<PasswordProblem, string> = {
  required: 'settings.password.required',
  short: 'settings.password.short',
  long: 'settings.password.long',
  same: 'settings.password.same',
  mismatch: 'settings.password.mismatch',
  totpFormat: 'settings.password.totpFormat',
  wrongCurrent: 'settings.password.wrongCurrent',
  weak: 'settings.password.weak',
  totpRequired: 'settings.password.totpRequired',
  totpWrong: 'settings.password.totpWrong',
  locked: 'settings.password.locked',
};
