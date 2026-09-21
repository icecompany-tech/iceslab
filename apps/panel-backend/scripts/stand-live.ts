/**
 * Make a LOCAL stand look alive, so the panel can be judged by eye.
 *
 * The seeded fleet points at hosts that do not exist (`*.example.com:1337`),
 * so the health poller marks all of it unreachable within thirty seconds, and
 * `lastStatusChange` then ages past the ninety-second grace in the
 * subscription query. From that moment the panel is truthful and useless for
 * looking at: zero endpoints, empty install block, one row of configs.
 *
 * ⚠ A seed alone cannot fix this. Whatever a seed writes, the next poll
 * overwrites, and there is no honest way to make a fake host answer. So this
 * does two things in one go:
 *
 *   1. takes the node pollers off the schedule (the three `node-*` repeatable
 *      jobs, not the whole queue: traffic resets and expiry review still run,
 *      and those tell the truth about seeded data);
 *   2. stamps every node as online with `lastStatusChange = NULL`, which the
 *      subscription's grace clause reads as "never changed", so the fleet
 *      stays in subscriptions rather than aging out again.
 *
 * `--thaw` puts the pollers back. So does restarting the backend: the boot
 * calls registerCronJobs() and re-adds everything, so re-run this after a
 * restart if the stand goes grey again.
 *
 *   pnpm --filter @iceslab/panel-backend exec tsx --env-file=../../.env scripts/stand-live.ts
 *   pnpm --filter @iceslab/panel-backend exec tsx --env-file=../../.env scripts/stand-live.ts --thaw
 *
 * Never against production: it lies about node health, which is the one thing
 * an operator's panel must not do.
 */
import { prisma } from '../src/prisma.js';
import { redis } from '../src/lib/infra/redis.js';
import { cronTasksQueue } from '../src/modules/scheduler/scheduler.queue.js';

/** The jobs that decide whether a node is alive. Everything else stays. */
const POLLERS = ['node-healthcheck-poll', 'node-metrics-poll', 'node-stats-poll'];

const thaw = process.argv.includes('--thaw');

function refuse(msg: string): never {
  console.error(`\n[stand] REFUSING TO RUN.\n  ${msg}\n`);
  process.exit(1);
}

if (process.env['NODE_ENV'] === 'production') {
  refuse('NODE_ENV=production. This marks nodes online without asking them.');
}
const url = process.env['DATABASE_URL'] ?? '';
if (!/localhost|127\.0\.0\.1|@postgres[:/]/.test(url)) {
  refuse(
    `DATABASE_URL does not look local (${url.replace(/:[^:@]*@/, ':***@')}). ` +
      `A stand is a throwaway database on your own machine.`,
  );
}

const repeatables = await cronTasksQueue.getRepeatableJobs();

if (thaw) {
  // Nothing to add back by hand: the backend re-registers every job at boot,
  // and it is the only place that knows the patterns. Say so rather than keep
  // a second copy of the schedule in this script, which would drift.
  console.log(
    'Restart the backend to put the pollers back: registerCronJobs() runs at boot\n' +
      'and re-adds all twelve with their patterns. Nothing else is needed.',
  );
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

let removed = 0;
for (const job of repeatables) {
  if (!POLLERS.includes(job.name)) continue;
  await cronTasksQueue.removeRepeatableByKey(job.key);
  removed++;
  console.log(`  poller off: ${job.name} (${job.pattern ?? job.every})`);
}
if (removed === 0) {
  console.log('  no node pollers on the schedule (already frozen, or the backend never booted)');
}

// `lastStatusChange: null` is the load-bearing half. The subscription query
// keeps a node whose status changed inside the grace window OR whose
// lastStatusChange is null, so a null keeps the fleet serving indefinitely
// instead of for ninety seconds.
const { count } = await prisma.node.updateMany({
  where: { deletedAt: null },
  data: { status: 'online', lastStatusChange: null, lastStatusMessage: null },
});

const live = await prisma.node.count({ where: { deletedAt: null, status: 'online' } });
const bindings = await prisma.profileNodeBinding.count();
console.log(`  nodes marked online: ${count} (${live} live, ${bindings} bindings)`);
console.log(
  '\nThe stand will stay this way until the backend restarts. If it goes grey,\n' +
    'run this again. To go back to the truth, restart the backend.',
);

await prisma.$disconnect();
await redis.quit();
