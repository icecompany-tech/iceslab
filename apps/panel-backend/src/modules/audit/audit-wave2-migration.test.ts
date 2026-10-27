import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';

/**
 * The migration of the audit log's wave 2 (source_network, the GIN index on
 * detail), run as its file says: forward, the header's rollback, forward
 * again, in one transaction rolled back at the end.
 */
const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../prisma/migrations/20261027070348_admin_audit_wave2/migration.sql',
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
  const [{ cols }] = await t.$queryRawUnsafe<{ cols: number }[]>(
    `SELECT count(*)::int AS cols FROM information_schema.columns WHERE table_name = 'admin_audit_events' AND column_name = 'source_network'`,
  );
  const [{ idx }] = await t.$queryRawUnsafe<{ idx: number }[]>(
    `SELECT count(*)::int AS idx FROM pg_indexes WHERE indexname = 'admin_audit_events_detail_idx'`,
  );
  return `${cols}/${idx}`;
};

describe('20261027070348_admin_audit_wave2', () => {
  it('reads its own statements: a column and an index forward, the two back', () => {
    expect(forward).toEqual([
      'ALTER TABLE "admin_audit_events" ADD COLUMN "source_network" VARCHAR(64)',
      'CREATE INDEX "admin_audit_events_detail_idx" ON "admin_audit_events" USING GIN ("detail" jsonb_path_ops)',
    ]);
    expect(rollback).toEqual([
      'DROP INDEX "admin_audit_events_detail_idx"',
      'ALTER TABLE "admin_audit_events" DROP COLUMN "source_network"',
    ]);
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
    expect(seen).toEqual(['1/1', '0/0', '1/1']);
    expect(await shape(prisma)).toBe('1/1');
  });
});
