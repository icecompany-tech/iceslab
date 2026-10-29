import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';

/**
 * A-288 (AUDT): the unique partial index that keeps one summary of refused
 * sign-ins per hour and key, run as its file says: forward, the header's
 * rollback, forward again, in one transaction rolled back at the end.
 */
const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../prisma/migrations/20261029063532_audit_login_summary_unique/migration.sql',
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

const has = async (t: typeof prisma) =>
  (
    await t.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'admin_audit_events_login_summary_key'`,
    )
  )[0]!.n;

describe('20261029063532_audit_login_summary_unique', () => {
  it('reads its own statements: one index forward, one drop back', () => {
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatch(/^CREATE UNIQUE INDEX "admin_audit_events_login_summary_key"/);
    expect(forward[0]).toContain(`WHERE "detail" ? 'suppressed'`);
    expect(rollback).toEqual(['DROP INDEX "admin_audit_events_login_summary_key"']);
  });

  it('runs back and forward again from the applied state', async () => {
    const seen: number[] = [];
    await expect(
      prisma.$transaction(
        async (tx) => {
          const t = tx as unknown as typeof prisma;
          seen.push(await has(t));
          for (const s of rollback) await t.$executeRawUnsafe(s);
          seen.push(await has(t));
          for (const s of forward) await t.$executeRawUnsafe(s);
          seen.push(await has(t));
          throw new Rollback();
        },
        { timeout: 30_000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);
    expect(seen).toEqual([1, 0, 1]);
    expect(await has(prisma)).toBe(1);
  });
});
