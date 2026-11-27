import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { config } from '../../config.js';
import { prisma } from '../../prisma.js';
import { enforceScopes } from '../auth/scope.hook.js';
import { _resetBindingsCacheForTest } from '../subscription/subscription.bindings-cache.js';
import { subscriptionRoutes } from '../subscription/subscription.routes.js';
import { ALL_SQUAD_ID } from './squads.constants.js';
import { squadsRoutes } from './squads.routes.js';

vi.mock('../../lib/infra/redis.js', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
  },
}));

const app = Fastify();
const first = { authorization: `Bearer icp_${randomUUID()}` };
const second = { authorization: `Bearer icp_${randomUUID()}` };
const readOnly = { authorization: `Bearer icp_${randomUUID()}` };
const route = '/api/squads/reorder';

beforeAll(async () => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return reply.send(error);
  });
  app.addHook('preHandler', enforceScopes);
  await app.register(squadsRoutes);
  await app.register(subscriptionRoutes);
});

beforeEach(async () => {
  await cleanDatabase();
  await prisma.apiToken.createMany({
    data: [first, second, readOnly].map(({ authorization }, i) => ({
      name: `Squad order test ${i}`,
      tokenHash: createHash('sha256').update(authorization.slice('Bearer '.length)).digest('hex'),
      scopes: i === 2 ? ['squads:read'] : ['squads:read', 'squads:write'],
      lastUsedAt: new Date(),
    })),
  });
});

afterAll(async () => {
  await cleanDatabase();
  await app.close();
  await prisma.$disconnect();
});

async function addSquad(name: string, profileIds: string[] = []) {
  const response = await app.inject({
    method: 'POST', url: '/api/squads', headers: first, payload: { name, profileIds },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

async function list(headers = first) {
  const response = await app.inject({ method: 'GET', url: '/api/squads', headers });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ squads: { id: string }[] }>().squads.map(({ id }) => id);
}

function reorder(expectedIds: string[], ids: string[], headers = first) {
  return app.inject({ method: 'PUT', url: route, headers, payload: { expectedIds, ids } });
}

describe('global squad order', () => {
  it('persists moves across pages for both operators and appends new squads', async () => {
    await prisma.group.createMany({ data: Array.from({ length: 67 }, (_, i) => ({ name: `Page row ${i}` })) });
    const before = await list();
    expect(before[0]).toBe(ALL_SQUAD_ID);
    expect(await list(second)).toEqual(before);

    const ids = [...before.slice(1), ALL_SQUAD_ID];
    const moved = await reorder(before, ids);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toEqual({ ids });
    expect(await list(second)).toEqual(ids);
    expect((await reorder(before, ids, second)).json()).toEqual({ ids });

    const newest = await addSquad('Newest');
    const appended = [...ids, newest];
    expect(await list(second)).toEqual(appended);
    const restoredFirst = [ALL_SQUAD_ID, ...ids.slice(0, -1), newest];
    expect((await reorder(appended, restoredFirst)).json()).toEqual({ ids: restoredFirst });
    const deleted = before[34]!;
    expect((await app.inject({ method: 'DELETE', url: `/api/squads/${deleted}`, headers: second })).statusCode).toBe(204);
    expect(await list()).toEqual(restoredFirst.filter((id) => id !== deleted));
  });

  it('returns the winning order on concurrent writes and rejects incomplete or stale orders', async () => {
    const a = await addSquad('Alpha');
    const b = await addSquad('Beta');
    const before = [ALL_SQUAD_ID, a, b];
    const [one, two] = await Promise.all([
      reorder(before, [b, ALL_SQUAD_ID, a]),
      reorder(before, [a, b, ALL_SQUAD_ID], second),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 409]);
    const winning = (one.statusCode === 200 ? one : two).json<{ ids: string[] }>().ids;
    const rejected = one.statusCode === 409 ? one : two;
    expect(rejected.json()).toMatchObject({ error: 'SQUAD_ORDER_CONFLICT', ids: winning });
    expect(await list(second)).toEqual(winning);
    const missing = await reorder([a, b], [b, a]);
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ error: 'SQUAD_ORDER_CONFLICT', ids: winning });
    expect((await reorder(before, [a, a, ALL_SQUAD_ID])).statusCode).toBe(400);
    expect((await reorder(before, [a, b, randomUUID()])).statusCode).toBe(400);
    expect(await list()).toEqual(winning);

    const newOrder = [...winning].reverse();
    const [inserted, move] = await Promise.all([addSquad('Race append'), reorder(winning, newOrder)]);
    const after = await list();
    expect([200, 409]).toContain(move.statusCode);
    expect(after.slice(0, -1)).toEqual(move.statusCode === 200 ? newOrder : winning);
    expect(after.at(-1)).toBe(inserted);
  });

  it('requires the write scope and keeps All protected from editing and deletion', async () => {
    const before = await list(readOnly);
    expect((await app.inject({ method: 'PUT', url: route, payload: { expectedIds: before, ids: before } })).statusCode).toBe(401);
    expect((await reorder(before, before, readOnly)).statusCode).toBe(403);
    expect((await app.inject({
      method: 'PUT', url: `/api/squads/${ALL_SQUAD_ID}`, headers: first, payload: { profileIds: [] },
    })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/squads/${ALL_SQUAD_ID}`, headers: first })).statusCode).toBe(403);
  });

  it('keeps every position when PostgreSQL rejects the update', async () => {
    const a = await addSquad('Alpha');
    const b = await addSquad('Beta');
    const before = [ALL_SQUAD_ID, a, b];
    await prisma.$executeRaw`ALTER TABLE "groups" ADD CONSTRAINT squad_order_test_reject CHECK (name <> 'Beta' OR display_order <> 1)`;
    try {
      expect((await reorder(before, [b, ALL_SQUAD_ID, a])).statusCode).toBe(500);
      expect(await list(second)).toEqual(before);
    } finally {
      await prisma.$executeRaw`ALTER TABLE "groups" DROP CONSTRAINT squad_order_test_reject`;
    }
  });

  it('returns the same nonempty subscription bytes for a member of multiple squads', async () => {
    const node = await prisma.node.create({
      data: { name: 'Synthetic node', address: 'squad-order.example.test', heartbeatSecret: randomBytes(32), status: 'online' },
    });
    const squadIds = [];
    for (const [name, port] of [['Alpha', 443], ['Beta', 8443]] as const) {
      const profile = await prisma.profile.create({ data: {
        name, protocol: 'xray',
        config: {
          security: 'reality', subprotocol: 'vless', network: 'raw',
          realityServerNames: ['example.test'], realityPublicKey: 'p'.repeat(43), realityShortIds: ['0123abcd'],
        },
      } });
      const binding = await prisma.profileNodeBinding.create({
        data: { profileId: profile.id, nodeId: node.id, port, transport: 'tcp' },
      });
      await prisma.host.create({ data: { bindingId: binding.id, remark: name, priority: port } });
      squadIds.push(await addSquad(name, [profile.id]));
    }

    const userId = randomUUID();
    const subscriptionToken = randomBytes(24).toString('hex');
    await prisma.user.create({ data: {
      id: userId, xrayUuid: userId, username: 'squad-order-user', shortId: 'squad-order',
      subscriptionToken, hysteriaPassword: 'synthetic', naivePassword: 'synthetic',
      amneziawgPrivateKey: 'synthetic', amneziawgPublicKey: 'synthetic',
      groupMembers: { create: squadIds.map((groupId) => ({ groupId })) },
    } });
    const subUrl = `${config.SUBSCRIPTION_PATH_PREFIX}/${subscriptionToken}?format=raw`;
    const before = await app.inject(subUrl);
    expect(before.statusCode).toBe(200);
    expect(before.body.split('\n').filter((line) => line.startsWith('vless://'))).toHaveLength(2);

    const initial = await list();
    const ids = [...initial].reverse();
    expect((await reorder(initial, ids)).statusCode).toBe(200);
    expect(await list(second)).toEqual(ids);
    _resetBindingsCacheForTest();
    const after = await app.inject(subUrl);
    expect(after.statusCode).toBe(200);
    expect(after.rawPayload.equals(before.rawPayload)).toBe(true);
  });
});
