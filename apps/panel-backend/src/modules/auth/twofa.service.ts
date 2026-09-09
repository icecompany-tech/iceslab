import { prisma } from '../../prisma.js';
import { generateSecret, totpUri, verifyTotp } from '../../lib/auth/totp.js';

// K8 - admin 2FA (TOTP) enrollment lifecycle. setup writes a pending secret;
// enable flips it on only after a valid code is confirmed (so a broken/
// mis-scanned secret can never lock the admin out); disable requires a current
// code so a stolen session can't silently turn 2FA off.

const ISSUER = 'Iceslab';

export class TotpNotSetupError extends Error {
  constructor() {
    super('2FA is not set up');
    this.name = 'TotpNotSetupError';
  }
}
export class TotpAlreadyEnabledError extends Error {
  constructor() {
    super('2FA is already enabled');
    this.name = 'TotpAlreadyEnabledError';
  }
}
export class TotpBadCodeError extends Error {
  constructor() {
    super('Invalid 2FA code');
    this.name = 'TotpBadCodeError';
  }
}

export async function getTotpStatus(adminId: string): Promise<{ enabled: boolean }> {
  const admin = await prisma.adminUser.findFirst({
    where: { id: adminId, deletedAt: null },
    select: { totpEnabled: true },
  });
  return { enabled: admin?.totpEnabled ?? false };
}

/** Generate a fresh secret (pending, not yet enforced) and return it + the
 *  otpauth URI for QR enrollment. Re-running before enable rotates the secret. */
export async function setupTotp(adminId: string): Promise<{ secret: string; uri: string }> {
  const admin = await prisma.adminUser.findFirst({ where: { id: adminId, deletedAt: null } });
  if (!admin) throw new TotpNotSetupError();
  if (admin.totpEnabled) throw new TotpAlreadyEnabledError();
  const secret = generateSecret();
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { totpSecret: secret, totpEnabled: false },
  });
  return { secret, uri: totpUri(secret, admin.username, ISSUER) };
}

/** Confirm a code against the pending secret and turn enforcement on. */
export async function enableTotp(adminId: string, code: string): Promise<void> {
  const admin = await prisma.adminUser.findFirst({ where: { id: adminId, deletedAt: null } });
  if (!admin?.totpSecret) throw new TotpNotSetupError();
  if (admin.totpEnabled) throw new TotpAlreadyEnabledError();
  if (!verifyTotp(admin.totpSecret, code)) throw new TotpBadCodeError();
  await prisma.adminUser.update({ where: { id: adminId }, data: { totpEnabled: true } });
}

/** Turn 2FA off. Requires a current valid code so a hijacked session can't. */
export async function disableTotp(adminId: string, code: string): Promise<void> {
  const admin = await prisma.adminUser.findFirst({ where: { id: adminId, deletedAt: null } });
  if (!admin?.totpEnabled || !admin.totpSecret) throw new TotpNotSetupError();
  if (!verifyTotp(admin.totpSecret, code)) throw new TotpBadCodeError();
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { totpSecret: null, totpEnabled: false },
  });
}
