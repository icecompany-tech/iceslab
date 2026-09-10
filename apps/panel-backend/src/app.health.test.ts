import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * /health has to say it in the status code.
 *
 * Nothing that watches this endpoint reads the body. The compose healthcheck
 * calls it and branches on `r.ok`, the frontend container waits on
 * `service_healthy` before it starts, CI polls it with `curl -fsS`, and an
 * uptime monitor looks at the code and nothing else. Until 2026-09-10 the
 * handler worked out 'degraded', put that in the JSON, and answered 200 anyway
 * - so a panel whose Postgres had fallen over was reported healthy to every one
 * of them, which is the one thing a health endpoint exists to prevent.
 *
 * The dependencies are mocked rather than actually stopped: the point is the
 * contract of the handler, and a test that shuts the test Postgres down would
 * take the rest of the suite with it.
 */
const pingDatabase = vi.fn<() => Promise<boolean>>();
const pingRedis = vi.fn<() => Promise<boolean>>();

vi.mock('./prisma.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prisma.js')>()),
  pingDatabase: () => pingDatabase(),
}));

vi.mock('./lib/infra/redis.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/infra/redis.js')>()),
  pingRedis: () => pingRedis(),
}));

const { buildApp } = await import('./app.js');
const { prisma } = await import('./prisma.js');
const { closeRedis } = await import('./lib/infra/redis.js');

let app: FastifyInstance;

beforeEach(async () => {
  pingDatabase.mockResolvedValue(true);
  pingRedis.mockResolvedValue(true);
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  vi.clearAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const health = () => app.inject({ method: 'GET', url: '/health' });

describe('GET /health', () => {
  it('answers 200 when both dependencies are up', async () => {
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('answers 503 when the database is down', async () => {
    // The regression: this used to be 200, so every watcher saw a healthy panel
    // while it could not read or write a single row.
    pingDatabase.mockResolvedValue(false);
    const res = await health();
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'degraded', db: 'down', redis: 'ok' });
  });

  it('answers 503 when redis is down', async () => {
    // Queues and rate limiting live in redis, so the panel is equally unable to
    // do its job; the endpoint already called this 'degraded' and must not
    // grade it differently from a dead database.
    pingRedis.mockResolvedValue(false);
    const res = await health();
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'degraded', db: 'ok', redis: 'down' });
  });

  it('keeps answering rather than dropping the connection', async () => {
    // 503 and not a closed socket: the reason has to reach the operator. A
    // healthcheck that times out says only "something", this names which half.
    pingDatabase.mockResolvedValue(false);
    pingRedis.mockResolvedValue(false);
    const res = await health();
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'degraded', db: 'down', redis: 'down' });
  });

  it('needs no authentication, an uptime probe carries no token', async () => {
    const res = await health();
    expect(res.statusCode).not.toBe(401);
  });
});
