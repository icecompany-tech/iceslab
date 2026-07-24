/**
 * Sets a known admin login on a local or test database so a human can log into
 * the panel during manual testing. Uses the same bcrypt cost the app does, so
 * the credential verifies through the normal login path.
 *
 * This is a blunt instrument. On an existing database it overwrites the first
 * admin's username and password AND disables their TOTP, so anyone who can run
 * it owns the panel. Hence the fence below: an explicit opt-in variable, a
 * refusal on production, and a refusal on any database that does not look
 * local or test. There is no default password on purpose, a known one baked
 * into a public repository is a backdoor waiting for someone to run this
 * against a reachable box.
 *
 * Run (against a LOCAL/TEST db, never prod):
 *   RESET_ADMIN=1 ADMIN_USER=admin ADMIN_PASS='choose-something-long' \
 *     DATABASE_URL='postgresql://...@127.0.0.1:5433/iceslab_test' \
 *     pnpm --filter @iceslab/panel-backend exec tsx scripts/reset-admin.ts
 *
 * Flags (env):
 *   RESET_ADMIN=1        required, confirms you meant to run this
 *   ADMIN_USER=admin     username to set (default: admin)
 *   ADMIN_PASS=...       required, at least 12 characters
 *   RESET_ADMIN_FORCE=1  bypass the local-db check, only if your test database
 *                        host is not 127.0.0.1/localhost and has no test marker
 */
import bcrypt from 'bcrypt';
import { prisma } from '../src/prisma.js';

// ───── Safety fence: this hands over the panel, never let it hit prod ─────

function refuse(msg: string): never {
  console.error(`\n[reset-admin] REFUSING TO RUN.\n  ${msg}\n`);
  process.exit(1);
}

function assertSafe(): void {
  if (process.env['NODE_ENV'] === 'production') {
    refuse('NODE_ENV=production. This overwrites admin credentials; never run against prod.');
  }
  if (process.env['RESET_ADMIN'] !== '1') {
    refuse('RESET_ADMIN=1 is required. Set it explicitly to confirm this is a throwaway db.');
  }
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) refuse('DATABASE_URL is empty. Point it at a local/test database first.');
  if (process.env['RESET_ADMIN_FORCE'] !== '1') {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      refuse(`DATABASE_URL is not a valid URL: ${url}`);
    }
    const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!local && !/test/i.test(url)) {
      refuse(
        `DATABASE_URL host "${host}" is not local and the URL has no "test" marker.\n` +
          '  Refusing so a prod URL can never slip through. Set RESET_ADMIN_FORCE=1 to override.',
      );
    }
  }
}

const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  assertSafe();

  const username = process.env['ADMIN_USER'] ?? 'admin';
  const password = process.env['ADMIN_PASS'] ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    refuse(
      `ADMIN_PASS must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}).\n` +
        '  There is no default: a password published in this repository is not a password.',
    );
  }

  const hash = await bcrypt.hash(password, 12);
  const existing = await prisma.adminUser.findFirst({ where: { deletedAt: null } });
  if (existing) {
    // Note what is being taken away, not just what is being set: an admin who
    // had TOTP on loses it here, and finding that out later is unpleasant.
    await prisma.adminUser.update({
      where: { id: existing.id },
      data: { username, passwordHash: hash, totpEnabled: false },
    });
    console.log(
      `[reset-admin] overwrote admin "${existing.username}" -> "${username}", TOTP disabled`,
    );
  } else {
    await prisma.adminUser.create({ data: { username, passwordHash: hash, role: 'admin' } });
    console.log(`[reset-admin] created admin "${username}"`);
  }
  console.log(`\n>>> LOGIN: ${username} (password as supplied in ADMIN_PASS)\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
