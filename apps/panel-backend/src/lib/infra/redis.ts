import { Redis } from 'ioredis';
import { config } from '../../config.js';

/**
 * Singleton Redis client.
 * Used by BullMQ queues (slice 7), cache (slice 12+), shared rate-limit store (later).
 *
 * `maxRetriesPerRequest: null` and `enableReadyCheck: false` are REQUIRED by BullMQ.
 */
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}