import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { registerCronJobs } from './scheduler.queue.js';

/**
 * A-042: a pattern changed in CRON_JOBS left the old repeatable firing beside
 * the new one, and a name taken out of the list fired for ever. Each test has
 * a queue of its own, so the real cron-tasks schedule is not touched.
 */
let queue: Queue;

beforeEach(() => {
  queue = new Queue(`cron-test-${randomUUID()}`, { connection: redis });
});

afterEach(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});

afterAll(async () => {
  await closeRedis();
});

const schedule = async () =>
  (await queue.getJobSchedulers()).map((s) => ({ key: s.key, pattern: s.pattern })).sort((a, b) => a.key.localeCompare(b.key));
const delayed = () => queue.getDelayedCount();

describe('registerCronJobs', () => {
  it('pattern A, then B: one entry, with B', async () => {
    await registerCronJobs(queue, [{ name: 'tick', pattern: '0 1 * * *' }]);
    await registerCronJobs(queue, [{ name: 'tick', pattern: '0 2 * * *' }]);
    expect(await schedule()).toEqual([{ key: 'tick', pattern: '0 2 * * *' }]);
    expect((await queue.getRepeatableJobs()).length).toBe(1);
    expect(await delayed()).toBe(1);
  });

  it('a name taken out of the list leaves nothing behind', async () => {
    await registerCronJobs(queue, [
      { name: 'stays', pattern: '0 1 * * *' },
      { name: 'goes', pattern: '0 3 * * *' },
    ]);
    await registerCronJobs(queue, [{ name: 'stays', pattern: '0 1 * * *' }]);
    expect(await schedule()).toEqual([{ key: 'stays', pattern: '0 1 * * *' }]);
    expect(await delayed()).toBe(1);

    await registerCronJobs(queue, []);
    expect(await queue.getRepeatableJobs()).toEqual([]);
    expect(await delayed()).toBe(0);
  });

  it('the repeatable an earlier version added (add with repeat and a fixed jobId) is taken off on the first boot', async () => {
    await queue.add('tick', {}, { repeat: { pattern: '0 1 * * *' }, jobId: 'cron:tick' });
    await queue.add('gone', {}, { repeat: { pattern: '0 4 * * *' }, jobId: 'cron:gone' });
    expect((await queue.getRepeatableJobs()).length).toBe(2);

    await registerCronJobs(queue, [{ name: 'tick', pattern: '0 2 * * *' }]);
    const left = await queue.getRepeatableJobs();
    expect(left.map((r) => ({ key: r.key, pattern: r.pattern }))).toEqual([{ key: 'tick', pattern: '0 2 * * *' }]);
    expect(await delayed()).toBe(1);
  });

  it('a second boot with the same list changes nothing', async () => {
    const jobs = [{ name: 'tick', pattern: '0 1 * * *' }];
    await registerCronJobs(queue, jobs);
    const first = await schedule();
    await registerCronJobs(queue, jobs);
    expect(await schedule()).toEqual(first);
    expect(await delayed()).toBe(1);
  });
});
