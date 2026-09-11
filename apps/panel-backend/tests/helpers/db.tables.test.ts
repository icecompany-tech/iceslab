import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../../src/prisma.js';
import { closeRedis } from '../../src/lib/infra/redis.js';
import { TABLES } from './db.js';

/**
 * Every table the app writes has to be in the truncate list.
 *
 * Three times now a table has been added to the schema and not to `TABLES`, and
 * each time it cost an hour and looked like somebody else's flake:
 *
 *   - route_policies (2026-07-30): unique on name and ordinal, so the first
 *     test that created one poisoned every later case in the run;
 *   - app_settings (2026-09-11): the entry-pool file set
 *     subscriptionEntryPoolSize and the NEXT file got a capped subscription;
 *   - node_policies / node_policy_rules (2026-09-11): "a policy with that name
 *     already exists", in a test that creates exactly one.
 *
 * The failure is always at a distance: one file decides another file's outcome,
 * so the test that fails is never the test that is wrong, and running it alone
 * passes. A comment does not help, it gets read after the hour is spent. This
 * fails immediately, in the diff that adds the table.
 *
 * Exceptions are listed explicitly rather than pattern-matched, so adding one
 * is a visible line in a review rather than a rule that silently widens.
 */
const EXEMPT = new Set<string>([
  // Prisma's own migration ledger. Truncating it would make every later run
  // believe the schema was never migrated.
  '_prisma_migrations',
]);

describe('the test-database truncate list', () => {
  it('covers every table the schema defines', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const listed = new Set(TABLES as readonly string[]);
    const missing = rows
      .map((r) => r.table_name)
      .filter((t) => !listed.has(t) && !EXEMPT.has(t))
      .sort();

    expect(
      missing,
      `these tables are not truncated between tests, so rows from one test will ` +
        `decide the outcome of another: ${missing.join(', ')}. Add them to TABLES ` +
        `in tests/helpers/db.ts (dependents first), or to EXEMPT here with a reason.`,
    ).toEqual([]);
  });

  it('lists no table that does not exist', async () => {
    // The other direction: a renamed or dropped table left in the list makes
    // every single cleanDatabase() throw, which is loud, but the message names
    // SQL rather than the rename that caused it.
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const real = new Set(rows.map((r) => r.table_name));
    const stale = (TABLES as readonly string[]).filter((t) => !real.has(t));
    expect(stale, `TABLES names tables that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});
