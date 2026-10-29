import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * A-284: a hysteria profile's port hopping range, both bounds or neither and
 * the end above the start, on create and on edit. Before, a half or reversed
 * range was saved and handed to every client as it was.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const call = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

const create = (config: Record<string, unknown>, name = 'hy') =>
  call('POST', '/api/profiles', { name, protocol: 'hysteria', config });

/** The issue the screen reads: its field and its words. */
function issueOf(body: string): { path: (string | number)[]; message: string } {
  const b = JSON.parse(body) as { error: string; issues: { path: (string | number)[]; message: string }[] };
  expect(b.error).toBe('VALIDATION_ERROR');
  return b.issues[0]!;
}

describe('a hysteria profile is created', () => {
  it.each([
    [{ portHoppingStart: 20000 }, 'portHoppingEnd'],
    [{ portHoppingEnd: 30000 }, 'portHoppingStart'],
    [{ portHoppingStart: 20000, portHoppingEnd: 20000 }, 'portHoppingEnd'],
    [{ portHoppingStart: 30000, portHoppingEnd: 20000 }, 'portHoppingEnd'],
  ])('%j is refused, 400 on config.%s', async (config, field) => {
    const res = await create(config);
    expect(res.statusCode, res.body).toBe(400);
    expect(issueOf(res.body).path).toEqual(['config', field]);
    expect(await prisma.profile.count()).toBe(0);
  });

  it('a range in order and no range at all are saved', async () => {
    expect((await create({ portHoppingStart: 20000, portHoppingEnd: 30000 }, 'ranged')).statusCode).toBe(201);
    expect((await create({}, 'plain')).statusCode).toBe(201);
  });
});

describe('a hysteria profile is edited', () => {
  it('one bound moved past the stored other one is refused, and the stored range stays', async () => {
    const res = await create({ portHoppingStart: 20000, portHoppingEnd: 30000 });
    const id = (JSON.parse(res.body) as { id: string }).id;
    const put = await call('PUT', `/api/profiles/${id}`, { config: { portHoppingStart: 35000, portHoppingEnd: 30000 } });
    expect(put.statusCode, put.body).toBe(400);
    expect(issueOf(put.body).path).toEqual(['config', 'portHoppingEnd']);
    const stored = (await prisma.profile.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;
    expect([stored.portHoppingStart, stored.portHoppingEnd]).toEqual([20000, 30000]);

    // One bound dropped: refused too.
    const half = await call('PUT', `/api/profiles/${id}`, { config: { portHoppingStart: 20000 } });
    expect(half.statusCode).toBe(400);
    expect(issueOf(half.body).path).toEqual(['config', 'portHoppingEnd']);

    // A range in order, and none: saved.
    expect((await call('PUT', `/api/profiles/${id}`, { config: { portHoppingStart: 21000, portHoppingEnd: 31000 } })).statusCode).toBe(200);
    expect((await call('PUT', `/api/profiles/${id}`, { config: {} })).statusCode).toBe(200);
  });
});
