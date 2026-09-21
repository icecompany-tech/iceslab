/**
 * Hard reset of the TEST database.
 *
 * ⚠ Read this before reaching for it: the suite does not need it. Every test
 * file truncates in `beforeEach` via `cleanDatabase()`, and a guard test
 * (tests/helpers/db.tables.test.ts) fails the day a new table is missing from
 * that list. A run therefore starts clean whatever the previous one left.
 *
 * The failures that look like leftovers are almost always a SECOND process
 * writing at the same time:
 *
 *   REGISTRATION_DISABLED          an admin exists that this file did not create
 *   Admin no longer exists         somebody truncated admin_users mid-file
 *   Node "eu-1" already exists     two files creating fixtures at once
 *   duplicate key … groups_pkey    two `cleanDatabase()` re-seeding the fixed
 *                                  "All" id in the same instant
 *
 * The last one is decisive: a LEFTOVER row would have been truncated a
 * millisecond earlier by the same statement. Two inserts of one uuid at once
 * cannot come from a dirty database, only from two writers. The usual writer
 * is a vitest that never died:
 *
 *   Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
 *     Where-Object { $_.CommandLine -like '*vitest*' }
 *
 * (PowerShell will leave one behind whenever a command pipes a run into
 * `Select-Object -First N`: that stops the pipeline, the shell returns, and
 * the child keeps going. Drain with `Out-String` first.)
 *
 * What this script is for is the genuinely wedged case: a run killed in the
 * middle of a truncate, a migration applied by hand, a schema that no longer
 * matches. It drops the schema and re-applies the migrations, which is the
 * only reset that also fixes structure.
 *
 *   pnpm --filter @iceslab/panel-backend exec tsx scripts/reset-test-db.ts
 */
import { Client } from 'pg';
import { execFileSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../../../.env.test');
const env = dotenvConfig({ path: envFile }).parsed ?? {};
const url = process.env.DATABASE_URL ?? env.DATABASE_URL;

if (!url) {
  console.error(`No DATABASE_URL, and none in ${envFile}.`);
  process.exit(1);
}

// Refuse anything that does not look like the test database. This script drops
// a schema; the one mistake it must never make is dropping the dev one.
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/test/i.test(dbName)) {
  console.error(
    `Refusing to reset "${dbName}": this script only ever touches a database ` +
      `with "test" in its name. Point DATABASE_URL at the test database.`,
  );
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

// Anything still connected would keep its locks and its view of the old
// schema, so say so rather than hang on the DROP.
const { rows: others } = await client.query<{ count: string }>(
  `SELECT count(*)::text FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()`,
  [dbName],
);
if (Number(others[0]?.count ?? 0) > 0) {
  console.warn(
    `⚠ ${others[0]!.count} other connection(s) to ${dbName}. A running vitest ` +
      `or a psql session will make this hang or come back. Close them first.`,
  );
}

await client.query('DROP SCHEMA public CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();
console.log(`schema dropped and recreated in ${dbName}`);

// Migrations, the same way the app applies them, so the reset database is the
// database the suite expects rather than one built by this script's idea of it.
execFileSync(
  process.execPath,
  [resolve(here, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  { cwd: resolve(here, '..'), stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } },
);
console.log('migrations applied; the test database is empty and current');
