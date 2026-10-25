import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { GetStatsResponse } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis, redis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeTransport } from '../nodes/nodes.transport.js';
import { pollNodeStats } from './stats.cron.js';
import { storeLingering } from './lingering.js';

/**
 * A-218: what the panel keeps of the agent's `lingering` and how the node and
 * the user say it. Absent from the agent is "not checked" (null), never none.
 */

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  const keys = await redis.keys('node:lingering:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

async function node(name: string): Promise<string> {
  const n = await prisma.node.create({
    data: { name, address: `${name}.example.com:1337`, protocol: 'xray', status: 'online', heartbeatSecret: randomBytes(32) },
    select: { id: true },
  });
  return n.id;
}

async function user(username: string, status = 'active'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: `Bearer ${token}` }, payload: { username } });
  expect(res.statusCode, res.body).toBe(201);
  const id = (JSON.parse(res.body) as { id: string }).id;
  if (status !== 'active') await prisma.user.update({ where: { id }, data: { status } });
  return id;
}

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
};

const stats = (lingering?: GetStatsResponse['lingering']): GetStatsResponse => ({
  users: [],
  uptime: 1,
  totalBytesIn: 0,
  totalBytesOut: 0,
  ...(lingering !== undefined ? { lingering } : {}),
});

describe('the poll keeps what the agent said, and only that', () => {
  it('no lingering from the agent: the node reads null, not checked', async () => {
    const id = await node('ru-01');
    vi.spyOn(NodeTransport.prototype, 'getStats').mockResolvedValue(stats());
    await pollNodeStats();
    expect((await get(`/api/nodes/${id}`)).lingering).toBeNull();
  });

  it('[] from the agent: checked, nobody', async () => {
    const id = await node('ru-01');
    vi.spyOn(NodeTransport.prototype, 'getStats').mockResolvedValue(stats([]));
    await pollNodeStats();
    expect((await get(`/api/nodes/${id}`)).lingering).toMatchObject({ users: [], observedAt: expect.any(String) });
  });

  it('a removed user by id and a socks login by username: named, with their status and sessions; one nobody knows: nulls', async () => {
    const id = await node('ru-01');
    const expired = await user('anna', 'expired');
    const narrowed = await user('boris');
    vi.spyOn(NodeTransport.prototype, 'getStats').mockResolvedValue(
      stats([
        { email: expired, sessions: 2 },
        { email: 'boris', sessions: 1 },
        { email: 'gone-login', sessions: 1 },
      ]),
    );
    await pollNodeStats();
    const got = (await get(`/api/nodes/${id}`)).lingering as { users: unknown[] };
    expect(got.users).toEqual([
      { userId: expired, username: 'anna', status: 'expired', sessions: 2 },
      { userId: narrowed, username: 'boris', status: 'active', sessions: 1 },
      { userId: null, username: null, status: null, sessions: 1 },
    ]);
  });

  it('the fact lives three polls: a key with a TTL, gone after', async () => {
    const id = await node('ru-01');
    await storeLingering(id, []);
    const ttl = await redis.ttl(`node:lingering:${id}`);
    expect(ttl).toBeGreaterThan(60);
    expect(ttl).toBeLessThanOrEqual(90);
  });
});

describe('the user card', () => {
  it('lists the nodes where the user still holds a connection, by id or by login', async () => {
    const a = await node('ru-01');
    const b = await node('nl-01');
    await node('se-01');
    const anna = await user('anna', 'disabled');
    await storeLingering(a, [{ email: anna, sessions: 1 }]);
    await storeLingering(b, [{ email: 'anna', sessions: 2 }, { email: 'someone', sessions: 1 }]);
    const got = (await get(`/api/users/${anna}`)).liveAfterRemoval as { nodeName: string; sessions: number }[];
    expect(got.map((g) => [g.nodeName, g.sessions]).sort()).toEqual([['nl-01', 2], ['ru-01', 1]]);
  });

  it('nowhere seen: []', async () => {
    await node('ru-01');
    const anna = await user('anna');
    expect((await get(`/api/users/${anna}`)).liveAfterRemoval).toEqual([]);
  });
});
