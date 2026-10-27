import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';

/**
 * The migration that adds admin_audit_events, run as its file says: forward,
 * the header's rollback, forward again, in one transaction rolled back at the
 * end, so the shared test database is left as it was whatever fails between.
 */
const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../prisma/migrations/20261027034521_admin_audit_events/migration.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

const split = (text: string) =>
  text
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const forward = split(
  sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n'),
);

const rollback = (() => {
  const lines = sql.split(/\r?\n/);
  const start = lines.findIndex((l) => /^--\s*ROLLBACK/i.test(l));
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith('--   ')) break;
    body.push(l.slice('--   '.length));
  }
  return split(body.join('\n')).filter((s) => !s.includes('_prisma_migrations'));
})();

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const shape = async (t: typeof prisma) => {
  const [{ tables }] = await t.$queryRawUnsafe<{ tables: number }[]>(
    `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_name = 'admin_audit_events'`,
  );
  // This file's indexes: the GIN on detail is wave 2's migration (its own
  // test, audit-wave2-migration.test.ts).
  const [{ indexes }] = await t.$queryRawUnsafe<{ indexes: number }[]>(
    `SELECT count(*)::int AS indexes FROM pg_indexes WHERE tablename = 'admin_audit_events' AND indexname <> 'admin_audit_events_detail_idx'`,
  );
  return `${tables}/${indexes}`;
};

describe('20261027034521_admin_audit_events', () => {
  it('reads its own statements: a table and three indexes forward, one drop back', () => {
    expect(forward).toHaveLength(4);
    expect(forward[0]).toMatch(/^CREATE TABLE "admin_audit_events"/);
    expect(forward.slice(1).every((s) => s.startsWith('CREATE INDEX'))).toBe(true);
    expect(rollback).toEqual(['DROP TABLE "admin_audit_events"']);
  });

  it('runs back and forward again from the applied state', async () => {
    const seen: string[] = [];
    await expect(
      prisma.$transaction(
        async (tx) => {
          const t = tx as unknown as typeof prisma;
          seen.push(await shape(t));
          for (const s of rollback) await t.$executeRawUnsafe(s);
          seen.push(await shape(t));
          for (const s of forward) await t.$executeRawUnsafe(s);
          seen.push(await shape(t));
          throw new Rollback();
        },
        { timeout: 30_000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);
    // The primary key's index and the three of the file.
    expect(seen).toEqual(['1/4', '0/0', '1/4']);
    expect(await shape(prisma)).toBe('1/4');
  });

  it('keeps the row when its admin is deleted, with no actor', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const admin = await tx.adminUser.create({ data: { username: 'audit-fk-probe', passwordHash: 'x' } });
        const row = await tx.adminAuditEvent.create({
          data: {
            actorKind: 'admin',
            actorId: admin.id,
            actorLabel: 'au***',
            action: 'user.delete',
            targetKind: 'user',
            targetLabel: 'us***',
            outcome: 'ok',
          },
        });
        await tx.adminUser.delete({ where: { id: admin.id } });
        const after = await tx.adminAuditEvent.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.actorId).toBeNull();
        expect(after.actorLabel).toBe('au***');
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
