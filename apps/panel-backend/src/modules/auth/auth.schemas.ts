import { z } from 'zod';
import { PasswordSchema } from '../admin/admin.schemas.js';

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  // K8 - optional 2FA code. Only consulted when the admin has 2FA enabled;
  // omitted on the first step so the UI can prompt for it after password OK.
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// K8 - body for the 2FA enable/disable endpoints (a current 6-digit code).
export const TotpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'A 6-digit code is required'),
});
export type TotpCodeInput = z.infer<typeof TotpCodeSchema>;

// A-039: the admin's own password, changed by the admin. The new one takes
// the rules register takes (PasswordSchema); the code is asked only of an
// admin with 2FA on.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: PasswordSchema,
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// Register uses the same shape as CreateAdmin
export { CreateAdminSchema as RegisterSchema } from '../admin/admin.schemas.js';
export type { CreateAdminInput as RegisterInput } from '../admin/admin.schemas.js';