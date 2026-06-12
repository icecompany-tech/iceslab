import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { prisma, pingDatabase } from './prisma.js';
import { pingRedis, closeRedis } from './lib/redis.js';
import { closeNodeTransport } from './modules/nodes/nodes.transport.js';
import { registerUserEventHandlers } from './modules/users/users.events.js';
import { registerNodeEventHandlers } from './modules/nodes/nodes.events.js';
import { registerInboundEventHandlers } from './modules/inbounds/inbounds.events.js';
import { registerWebhookEventHandlers } from './modules/webhooks/webhook.events.js';
import { registerBindingsCacheBust } from './modules/subscription/subscription.bindings-cache.js';
import { startNodeUsersWorker } from './modules/users/users.queue.js';
import { startInboundSyncWorker } from './modules/inbounds/inbounds.queue.js';
import {
  startCronTasksWorker,
  registerCronJobs,
} from './modules/scheduler/scheduler.queue.js';
import { buildApp } from './app.js';
import { setBaseLogger } from './lib/logger.js';
import { startMetricsRefreshLoop } from './lib/metrics-refresh.js';
import { startTelegramBot } from './lib/telegram-bot.js';

let app: FastifyInstance | null = null;
let nodeUsersWorker: Worker | null = null;
let inboundSyncWorker: Worker | null = null;
let cronTasksWorker: Worker | null = null;
let stopMetricsRefresh: (() => void) | null = null;
let stopTelegramBot: (() => void) | null = null;

async function start() {
  try {
    const dbOk = await pingDatabase();
    if (!dbOk) {
      console.error('Cannot connect to database at startup');
      process.exit(1);
    }

    const redisOk = await pingRedis();
    if (!redisOk) {
      console.error('Cannot connect to redis at startup');
      process.exit(1);
    }

    registerUserEventHandlers();
    registerNodeEventHandlers();
    registerInboundEventHandlers();
    registerWebhookEventHandlers();
    // B6 - invalidate the /sub binding cache on profile/binding/node changes.
    registerBindingsCacheBust();
    nodeUsersWorker = startNodeUsersWorker();
    inboundSyncWorker = startInboundSyncWorker();
    cronTasksWorker = startCronTasksWorker();

    app = await buildApp();
    // Route background-job logs (crons, queue workers, event-bus) through the
    // app's pino instance instead of console.log (B15). Workers started just
    // above only log when a job fires (>=15s later), so the logger is in place.
    setBaseLogger(app.log);
    app.log.info('Database connection verified');
    app.log.info('Redis connection verified');
    app.log.info('Event handlers registered');
    app.log.info('Workers started');

    await registerCronJobs();
    app.log.info('Cron jobs registered');

    stopMetricsRefresh = startMetricsRefreshLoop();
    app.log.info('Metrics refresh loop started');

    // K3 - operator Telegram bot (no-op when Telegram isn't configured).
    stopTelegramBot = startTelegramBot();

    await app.listen({ port: config.APP_PORT, host: config.APP_HOST });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

async function shutdown() {
  if (app) {
    app.log.info('Shutting down...');
    await app.close();
  }
  if (nodeUsersWorker) {
    await nodeUsersWorker.close();
  }
  if (inboundSyncWorker) {
    await inboundSyncWorker.close();
  }
  if (cronTasksWorker) {
    await cronTasksWorker.close();
  }
  if (stopMetricsRefresh) {
    stopMetricsRefresh();
  }
  if (stopTelegramBot) {
    stopTelegramBot();
  }
  await closeNodeTransport();
  await prisma.$disconnect();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
