/**
 * Users-list stress probe. Seeds N throwaway users, then exercises the REAL
 * repository `list()` (skip/take + count) across shallow, middle, deep and
 * past-500 pages, timing each call. Answers two questions empirically:
 *
 *   1. Is the users list capped at 500, as is sometimes claimed?  -> we page
 *      past row 500 and past 6800 and check the rows + `total` come back whole.
 *   2. What actually degrades at scale?  -> deep OFFSET pagination (Postgres
 *      scans + discards `skip` rows) and the separate COUNT(*) are the honest
 *      cost centres, so we time them in isolation, not the cap.
 *
 * It imports the same `list()` the API route calls, so this tests production
 * code, not a re-implementation.
 *
 * Run (WSL, against a LOCAL/TEST db - never prod):
 *   STRESS=1 DATABASE_URL='postgresql://...@127.0.0.1:5433/iceslab_test' \
 *     pnpm --filter @iceslab/panel-backend exec tsx scripts/stress-users.ts
 *
 * Flags (env):
 *   STRESS_COUNT=7000   how many users to seed (default 7000, a few thousand more
 *                       than a busy single-operator panel carries)
 *   STRESS_KEEP=1       do NOT delete the seeded users at the end (e.g. to then
 *                       shoot a UI screenshot). Default: clean up.
 *   STRESS_FORCE=1      bypass the local-db safety fence (use only if your test
 *                       db host is not 127.0.0.1/localhost/*test*).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { list } from '../src/modules/users/users.repository.js';

const STRESS_TAG = '__stress__'; // every seeded row carries this tag -> exact cleanup
const COUNT = Number(process.env['STRESS_COUNT'] ?? 7000);
const KEEP = process.env['STRESS_KEEP'] === '1';
const LIMIT = 25; // matches the UsersPage default page size

// ───── Safety fence: this writes + deletes rows, never let it hit prod ─────

function refuse(msg: string): never {
  console.error(`\n[stress-users] REFUSING TO RUN.\n  ${msg}\n`);
  process.exit(1);
}

function assertSafe(): void {
  if (process.env['NODE_ENV'] === 'production') {
    refuse('NODE_ENV=production. This seeds and deletes users; never run against prod.');
  }
  if (process.env['STRESS'] !== '1') {
    refuse('STRESS=1 is required. Set it explicitly to confirm this is a throwaway db.');
  }
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) refuse('DATABASE_URL is empty. Point it at a local/test database first.');
  if (process.env['STRESS_FORCE'] === '1') return;
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
        '  Refusing so a prod URL can never slip through. Set STRESS_FORCE=1 to override.',
    );
  }
}

// ───── Seed ──────────────────────────────────────────────────────────────

function makeRow(i: number) {
  const h = randomBytes(16).toString('hex'); // 32 chars, fits VarChar(64)
  return {
    shortId: `zzst${i.toString(36)}`, // <=16, distinct, "zzst" prefix dodges real ids
    username: `zzstress_${i}`,
    status: 'active',
    subscriptionToken: `zzst_${i}_${randomBytes(6).toString('hex')}`,
    hysteriaPassword: h,
    amneziawgPrivateKey: h,
    amneziawgPublicKey: h,
    naivePassword: h,
    xrayUuid: randomUUID(),
    tag: STRESS_TAG,
  };
}

async function seed(): Promise<void> {
  const existing = await prisma.user.count({ where: { tag: STRESS_TAG } });
  if (existing > 0) {
    console.log(`[seed] found ${existing} leftover stress rows, wiping first`);
    await prisma.user.deleteMany({ where: { tag: STRESS_TAG } });
  }
  const BATCH = 1000;
  const t0 = Date.now();
  for (let start = 0; start < COUNT; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, COUNT); i++) rows.push(makeRow(i));
    await prisma.user.createMany({ data: rows, skipDuplicates: true });
    process.stdout.write(`\r[seed] ${Math.min(start + BATCH, COUNT)}/${COUNT}`);
  }
  console.log(`\n[seed] done in ${Date.now() - t0}ms`);
}

// ───── Probe ─────────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

async function probe(): Promise<void> {
  const total = await prisma.user.count({ where: { tag: STRESS_TAG, deletedAt: null } });
  const lastPage = Math.ceil(total / LIMIT);
  const midPage = Math.floor(lastPage / 2);
  const past500Page = Math.floor(500 / LIMIT) + 1; // page 21 @ limit 25 -> rows 501..525

  console.log(`\n=== PROBE (total seeded active = ${total}, limit = ${LIMIT}) ===\n`);

  const cases: Array<[string, number]> = [
    ['page 1        (rows 1..25)', 1],
    [`page ${past500Page}       (rows 501..525, PAST the alleged 500 cap)`, past500Page],
    [`page ${midPage}      (middle, deep-ish offset)`, midPage],
    [`page ${lastPage}      (LAST page, deepest offset ~${(lastPage - 1) * LIMIT})`, lastPage],
  ];

  let sawPast500 = false;
  let sawLast = false;
  for (const [label, page] of cases) {
    const [res, ms] = await timed(() => list({ page, limit: LIMIT } as never));
    const first = res.users[0]?.username ?? '(none)';
    const rows = res.users.length;
    console.log(
      `${label}\n    -> ${rows} rows, total=${res.total}, ${ms}ms   first=${first}`,
    );
    if (page === past500Page && rows > 0 && res.total === total) sawPast500 = true;
    if (page === lastPage && rows > 0) sawLast = true;
  }

  // Max page size (limit=500) beyond the first 500 rows: proves the number 500
  // is a per-request page size, not a global ceiling on how many users exist.
  const [big, bigMs] = await timed(() =>
    list({ page: Math.ceil(total / 500), limit: 500 } as never),
  );
  console.log(
    `\nlimit=500, last page   -> ${big.users.length} rows, total=${big.total}, ${bigMs}ms`,
  );

  // Isolated COUNT(*) cost (the list() above pays it every call in parallel).
  const [, countMs] = await timed(() =>
    prisma.user.count({ where: { tag: STRESS_TAG, deletedAt: null } }),
  );
  console.log(`COUNT(*) with where -> ${countMs}ms`);

  // ── Verdict ──
  const noCap = sawPast500 && sawLast && total === COUNT;
  console.log('\n=== VERDICT ===');
  console.log(
    noCap
      ? `NO 500 CAP. All ${total} users are reachable via page/limit; rows 501+ and the\n` +
          `last page return whole, total reflects the full ${total}. Server-side offset\n` +
          `pagination works at ${COUNT} users.`
      : `UNEXPECTED: could not confirm full reachability. Inspect the rows above.`,
  );
  console.log(
    `Perf note: deep-offset + COUNT are the only cost centres to watch as N grows.\n` +
      `If the deepest page and COUNT(*) above are both small (tens of ms), the real\n` +
      `scale story is fine; a large number there is the thing worth optimising - NOT a cap.`,
  );
}

// ───── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertSafe();
  console.log(`[stress-users] seeding ${COUNT} users tagged "${STRESS_TAG}"`);
  try {
    await seed();
    await probe();
  } finally {
    if (KEEP) {
      console.log(`\n[cleanup] STRESS_KEEP=1 -> leaving ${COUNT} stress rows in place.`);
      console.log(`          delete later with: tag = "${STRESS_TAG}"`);
    } else {
      const del = await prisma.user.deleteMany({ where: { tag: STRESS_TAG } });
      console.log(`\n[cleanup] deleted ${del.count} stress rows.`);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
