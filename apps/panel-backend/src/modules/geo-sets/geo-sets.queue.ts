import { Queue, Worker, type Job } from 'bullmq';
import { GEO_BUILTIN, GEO_SET_KINDS, type GeoSetKind } from '@iceslab/shared';
import { redis } from '../../lib/infra/redis.js';
import { getLogger } from '../../lib/infra/logger.js';
import { builtinNeedsFetch, ensureBuiltinSets, fetchBuiltin } from './geo-sets.store.js';

/**
 * Geo files are fetched and checked in the background: a list of tens of
 * megabytes does not hold an HTTP request open, and the set says `checking`
 * meanwhile (geo-contract.md section 5).
 */

export interface FetchBuiltinJobData {
  kind: GeoSetKind;
}

const QUEUE_NAME = 'geo-sets';

export const geoSetsQueue = new Queue<FetchBuiltinJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // One attempt: a failure is written on the set as `broken` in words, and
    // a retry would flip it back to `checking` behind the operator's back.
    // The next start, or "refresh now", tries again.
    attempts: 1,
    // Gone as soon as done: BullMQ ignores an add() whose job id still
    // exists, and a kept job would stop the next start from retrying a
    // broken fetch. The id only has to dedupe jobs waiting or running.
    removeOnComplete: true,
    removeOnFail: true,
  },
});

/**
 * On start: both built-in sets exist, and the ones not yet on the pinned
 * release get a fetch. The job id names the release, so two starts in a row
 * do not queue the same download twice.
 */
export async function scheduleBuiltinFetch(): Promise<void> {
  await ensureBuiltinSets();
  for (const kind of GEO_SET_KINDS) {
    if (!(await builtinNeedsFetch(kind))) continue;
    await geoSetsQueue.add('fetchBuiltin', { kind }, { jobId: `builtin-${kind}-${GEO_BUILTIN[kind].tag}` });
  }
}

export function startGeoSetsWorker(): Worker<FetchBuiltinJobData> {
  return new Worker<FetchBuiltinJobData>(
    QUEUE_NAME,
    async (job: Job<FetchBuiltinJobData>) => {
      switch (job.name) {
        case 'fetchBuiltin':
          await fetchBuiltin(job.data.kind);
          break;
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    // One at a time: each job holds a whole file in memory.
    { connection: redis, concurrency: 1 },
  ).on('failed', (job, err) => {
    getLogger().info(`[worker:geo-sets] ${job?.name} ${JSON.stringify(job?.data)} FAILED: ${err.message}`);
  });
}
