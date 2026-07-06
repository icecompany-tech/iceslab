import { Queue, Worker, type Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import {
  resetTrafficForStrategy,
  resetTrafficRolling,
  findExpiredUsers,
  findExceededTrafficUsers,
  reconcileOrphanNodeUsers,
  alertNearLimits,
} from '../users/users.cron.js';
import { pollNodeStatuses, pollNodeMetrics } from '../nodes/nodes.cron.js';
import { pollNodeStats } from '../stats/stats.cron.js';
import { pruneHistory } from '../maintenance/retention.cron.js';
import { getLogger } from '../../lib/logger.js';

// ───── Queue ─────

const QUEUE_NAME = 'cron-tasks';

// Cron-задачи без полезной нагрузки, имя джоба сам себе данные.
export const cronTasksQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400 },
  },
});

// ───── Job names + расписание (зеркалим Remnawave) ─────

interface CronJobSpec {
  name: string;
  pattern: string; // cron-выражение
}

// Demo mode: when DEMO=1 the panel is pointed at a seeded demo DB whose nodes
// are fake (*.example.com) and never answer mTLS. The three node pollers would
// flip those seeded-online nodes to "unreachable" within 30s and let the
// telemetry TTL out, so the dashboard would go cold mid-screenshot. Gate them
// off so a `seed:demo` dataset stays lively for as long as the demo runs.
const DEMO_MODE = process.env['DEMO'] === '1';
const NODE_POLL_JOBS = new Set([
  'node-healthcheck-poll',
  'node-metrics-poll',
  'node-stats-poll',
]);

const CRON_JOBS: CronJobSpec[] = [
  { name: 'reset-traffic-daily',            pattern: '5 0 * * *'  }, // 00:05 каждый день
  { name: 'reset-traffic-monthly-rolling',  pattern: '10 0 * * *' }, // 00:10 каждый день (rolling 30d)
  { name: 'reset-traffic-weekly',           pattern: '15 0 * * 1' }, // понедельник 00:15
  { name: 'reset-traffic-monthly',          pattern: '20 0 1 * *' }, // 1-е число 00:20
  { name: 'review-find-expired',            pattern: '*/30 * * * * *' }, // каждые 30 секунд
  { name: 'review-find-exceeded-traffic',   pattern: '*/45 * * * * *' }, // каждые 45 секунд
  { name: 'node-healthcheck-poll',          pattern: '*/30 * * * * *' }, // каждые 30 секунд
  { name: 'node-metrics-poll',              pattern: '*/15 * * * * *' }, // каждые 15 секунд
  { name: 'node-stats-poll',                pattern: '*/30 * * * * *' }, // каждые 30 секунд - per-user/per-node traffic
  { name: 'reconcile-orphan-users',         pattern: '*/10 * * * *' },   // каждые 10 минут - catch-up for status-flip crashes / dropped jobs
  { name: 'prune-history',                  pattern: '30 3 * * *' },     // 03:30 каждый день - B2 retention для append-only history-таблиц
  { name: 'alert-near-expiry',              pattern: '0 9 * * *'  },     // 09:00 каждый день - K3 near-expiry/near-cap дайджест в Telegram
];

// ───── Регистрация (вызывается один раз при бутстрапе) ─────

export async function registerCronJobs(): Promise<void> {
  const jobs = DEMO_MODE ? CRON_JOBS.filter((j) => !NODE_POLL_JOBS.has(j.name)) : CRON_JOBS;
  for (const job of jobs) {
    await cronTasksQueue.add(
      job.name,
      {},
      {
        repeat: { pattern: job.pattern },
        // jobId фиксирован, чтобы повторный запуск не дублировал расписание
        jobId: `cron:${job.name}`,
      },
    );
  }
  if (DEMO_MODE) {
    // Leftover node-poll schedules from a prior non-demo run (same Redis) are
    // neutralised by the worker-level guard below, so we don't fight BullMQ's
    // version-specific removeRepeatable signature here.
    getLogger().info('[scheduler] DEMO=1 - node health/metrics/stats polls gated off');
  }
  getLogger().info(`[scheduler] registered ${jobs.length} cron jobs`);
}

// ───── Worker ─────

export function startCronTasksWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      // DEMO=1 safety net: even if a node-poll schedule survives in Redis from
      // a prior non-demo run, make it a no-op so seeded demo nodes never flip
      // to "unreachable" and their telemetry never gets re-polled away.
      if (DEMO_MODE && NODE_POLL_JOBS.has(job.name)) return;
      switch (job.name) {
        case 'reset-traffic-daily': {
          const n = await resetTrafficForStrategy('day');
          if (n > 0) getLogger().info(`[cron] reset-traffic-daily - reset ${n} users`);
          break;
        }
        case 'reset-traffic-weekly': {
          const n = await resetTrafficForStrategy('week');
          if (n > 0) getLogger().info(`[cron] reset-traffic-weekly - reset ${n} users`);
          break;
        }
        case 'reset-traffic-monthly': {
          const n = await resetTrafficForStrategy('month');
          if (n > 0) getLogger().info(`[cron] reset-traffic-monthly - reset ${n} users`);
          break;
        }
        case 'reset-traffic-monthly-rolling': {
          const n = await resetTrafficRolling();
          if (n > 0) getLogger().info(`[cron] reset-traffic-monthly-rolling - reset ${n} users`);
          break;
        }
        case 'review-find-expired': {
          const n = await findExpiredUsers();
          if (n > 0) getLogger().info(`[cron] review-find-expired - flipped ${n} users → expired`);
          break;
        }
        case 'review-find-exceeded-traffic': {
          const n = await findExceededTrafficUsers();
          if (n > 0) getLogger().info(`[cron] review-find-exceeded-traffic - flipped ${n} users → limited`);
          break;
        }
        case 'node-healthcheck-poll': {
          const { ok, down } = await pollNodeStatuses();
          // Only log when something is actually unhealthy, quiet ticks keep
          // the journal readable. ok-counts don't matter unless you graph them.
          if (down > 0) {
            getLogger().info(`[cron] node-healthcheck-poll - ${ok} online, ${down} unreachable`);
          }
          break;
        }
        case 'node-metrics-poll': {
          const { failed } = await pollNodeMetrics();
          if (failed > 0) {
            getLogger().info(`[cron] node-metrics-poll - ${failed} nodes failed to report metrics`);
          }
          break;
        }
        case 'node-stats-poll': {
          const { failed } = await pollNodeStats();
          if (failed > 0) {
            getLogger().info(`[cron] node-stats-poll - ${failed} nodes failed`);
          }
          break;
        }
        case 'reconcile-orphan-users': {
          const n = await reconcileOrphanNodeUsers();
          if (n > 0) getLogger().info(`[cron] reconcile-orphan-users - re-queued removeUser for ${n} users`);
          break;
        }
        case 'alert-near-expiry': {
          const n = await alertNearLimits();
          if (n > 0) getLogger().info(`[cron] alert-near-expiry - digest sent for ${n} user(s)`);
          break;
        }
        case 'prune-history': {
          const r = await pruneHistory();
          const total = r.subscriptionRequests + r.nodeUserUsage + r.nodeUsage + r.bootstrapTokens;
          if (total > 0) {
            getLogger().info(
              `[cron] prune-history - deleted ${r.subscriptionRequests} sub-req, ${r.nodeUserUsage} user-usage, ${r.nodeUsage} node-usage, ${r.bootstrapTokens} bootstrap-token rows`,
            );
          }
          break;
        }
        default:
          throw new Error(`Unknown cron job: ${job.name}`);
      }
    },
    {
      connection: redis,
      concurrency: 1, // cron-задачи строго последовательно
    },
  );
}
