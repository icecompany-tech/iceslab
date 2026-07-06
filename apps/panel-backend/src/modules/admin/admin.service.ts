import bcrypt from 'bcrypt';
import { prisma } from '../../prisma.js';
import type { CreateAdminInput } from './admin.schemas.js';
import { mapAdminToPublic, type PublicAdminDto } from './admin.mapper.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';

const BCRYPT_COST = 12;

export class AdminAlreadyExistsError extends Error {
  constructor(public username: string) {
    super(`Admin "${username}" already exists`);
    this.name = 'AdminAlreadyExistsError';
  }
}

export class AdminNotFoundError extends Error {
  constructor() {
    super('Admin not found');
    this.name = 'AdminNotFoundError';
  }
}

export class RegistrationDisabledError extends Error {
  constructor() {
    super('Registration is allowed only when no admins exist');
    this.name = 'RegistrationDisabledError';
  }
}

// Postgres advisory-lock key for the bootstrap path. Arbitrary constant,
// only matters that every bootstrap attempt picks the same value so the
// lock actually serializes them. int4 range (signed 32-bit).
const BOOTSTRAP_LOCK_KEY = 91_823_746;

export async function countAdmins(): Promise<number> {
  return prisma.adminUser.count({ where: { deletedAt: null } });
}

export async function createAdmin(input: CreateAdminInput): Promise<PublicAdminDto> {
  const existing = await prisma.adminUser.findFirst({
    where: { username: input.username, deletedAt: null },
  });
  if (existing) {
    throw new AdminAlreadyExistsError(input.username);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const admin = await prisma.adminUser.create({
    data: {
      username: input.username,
      passwordHash,
      role: 'admin',
    },
  });

  notifyTelegramAsync(
    `👤 *Admin created*\nusername: \`${escapeMarkdown(admin.username)}\`\nrole: \`${admin.role}\``,
  );

  return mapAdminToPublic(admin);
}

// bootstrapFirstAdmin is the only path that creates the very first admin
// (no auth required). Two concurrent POSTs to /api/auth/register would
// otherwise both see count===0 and both succeed, bypassing the "only one
// bootstrap" invariant. We serialize via a Postgres transaction-scoped
// advisory lock: every concurrent attempt waits for the lock, then re-checks
// the count under the lock. Lock is auto-released at transaction end.
export async function bootstrapFirstAdmin(input: CreateAdminInput): Promise<PublicAdminDto> {
  // bcrypt is CPU-heavy; do it before the transaction so we don't hold the
  // lock + a DB connection for ~250 ms on every attempt.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const admin = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

    const count = await tx.adminUser.count({ where: { deletedAt: null } });
    if (count > 0) {
      throw new RegistrationDisabledError();
    }

    return tx.adminUser.create({
      data: {
        username: input.username,
        passwordHash,
        role: 'admin',
      },
    });
  });

  notifyTelegramAsync(
    `👤 *Admin created*\nusername: \`${escapeMarkdown(admin.username)}\`\nrole: \`${admin.role}\``,
  );

  return mapAdminToPublic(admin);
}

export async function findAdminByUsername(username: string) {
  return prisma.adminUser.findFirst({
    where: { username, deletedAt: null },
  });
}

export async function findAdminById(id: string) {
  return prisma.adminUser.findFirst({
    where: { id, deletedAt: null },
  });
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * #14 - record the time-step of the last accepted TOTP code so a subsequent
 * login can reject a replayed code (any step <= the stored one).
 */
export async function recordTotpStep(adminId: string, step: number): Promise<void> {
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { totpLastUsedStep: step },
  });
}
