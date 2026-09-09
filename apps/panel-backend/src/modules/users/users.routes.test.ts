import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

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

const auth = () => ({ authorization: `Bearer ${token}` });

describe('POST /api/users', () => {
  it('creates a user with default values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'alice' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('alice');
    expect(body.status).toBe('active');
    expect(body.trafficLimitStrategy).toBe('no_reset');
    expect(body.trafficLimitBytes).toBeNull();
    expect(body.expireAt).toBeNull();

    // Public DTO must not leak protocol secrets
    expect(body).not.toHaveProperty('hysteriaPassword');
    expect(body).not.toHaveProperty('amneziawgPrivateKey');
    expect(body).not.toHaveProperty('xrayUuid');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'noauth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 409 when username is already taken', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'dup' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'dup' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('CONFLICT');
  });

  it('returns 400 for invalid traffic strategy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'badstrat', trafficLimitStrategy: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/users', () => {
  it('returns paginated list', async () => {
    for (const username of ['user_a', 'user_b', 'user_c']) {
      await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: auth(),
        payload: { username },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/users?page=1&limit=10',
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(3);
    expect(body.users).toHaveLength(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
  });

  // R3 - a per-user routing override lives in a collapsed Advanced block on one
  // user's page, so without a filter nobody can answer "who did we pin". These
  // pin the three shapes of the query.
  describe('routingPreset filter', () => {
    async function seed() {
      for (const [username, routingPreset] of [
        ['pinned_ru', 'ru-split'],
        ['pinned_all', 'proxy-all'],
        ['inherits', null],
      ] as const) {
        await app.inject({
          method: 'POST',
          url: '/api/users',
          headers: auth(),
          payload: { username, ...(routingPreset ? { routingPreset } : {}) },
        });
      }
    }

    const list = async (qs: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/users?${qs}`, headers: auth() });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.body).users.map((u: { username: string }) => u.username).sort();
    };

    it('keeps only users pinned to one preset', async () => {
      await seed();
      expect(await list('routingPreset=ru-split')).toEqual(['pinned_ru']);
    });

    it('`any` keeps everyone carrying an override', async () => {
      await seed();
      expect(await list('routingPreset=any')).toEqual(['pinned_all', 'pinned_ru']);
    });

    it('`none` keeps the ones that inherit', async () => {
      await seed();
      expect(await list('routingPreset=none')).toEqual(['inherits']);
    });

    it('rejects a preset that does not exist rather than returning everyone', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?routingPreset=not-a-preset',
        headers: auth(),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('POST /api/hosts without a binding', () => {
  // Until 2026-07-30 creating a host required a bindingId, and nothing in the
  // panel created bindings. A fresh install could not produce a single host by
  // any route: the create screen looked up an existing binding for the chosen
  // profile+node, found none, and left its button permanently disabled.
  async function seedProfileAndNode() {
    const profile = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: {
        name: `p-${Math.random().toString(36).slice(2, 8)}`,
        protocol: 'xray',
        config: {
          security: 'reality',
          realityDest: 'www.microsoft.com:443',
          realityServerNames: ['www.microsoft.com'],
          realityPrivateKey: 'k'.repeat(43),
          realityPublicKey: 'p'.repeat(43),
          realityShortIds: ['0123abcd'],
          network: 'raw',
        },
      },
    });
    expect(profile.statusCode).toBe(201);
    const node = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: `n-${Math.random().toString(36).slice(2, 8)}`,
        address: `${Math.random().toString(36).slice(2, 8)}.example.com`,
        protocol: 'xray',
      },
    });
    expect(node.statusCode).toBe(201);
    return { profileId: JSON.parse(profile.body).id, nodeId: JSON.parse(node.body).id };
  }

  it('creates the binding under the host in one call', async () => {
    const { profileId, nodeId } = await seedProfileAndNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId, nodeId, port: 443, remark: 'Direct' },
    });
    expect(res.statusCode).toBe(201);
    const host = JSON.parse(res.body);
    expect(host.remark).toBe('Direct');
    expect(host.bindingId).toBeTruthy();

    // Exactly one host: the binding must NOT also seed a default one, or every
    // user would be handed the same endpoint twice.
    const list = await app.inject({
      method: 'GET',
      url: `/api/hosts?nodeId=${nodeId}`,
      headers: auth(),
    });
    expect(JSON.parse(list.body).hosts).toHaveLength(1);
  });

  it('reuses the binding for a second host on the same node', async () => {
    const { profileId, nodeId } = await seedProfileAndNode();
    const first = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId, nodeId, port: 443, remark: 'Direct' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId, nodeId, port: 443, remark: 'CDN' },
    });
    expect(second.statusCode).toBe(201);
    // A CDN-fronted variant next to the direct one is ordinary; both hang off
    // the same binding rather than the second call erroring.
    expect(JSON.parse(second.body).bindingId).toBe(JSON.parse(first.body).bindingId);
  });

  it('leaves no binding behind when the host is rejected', async () => {
    const { profileId, nodeId } = await seedProfileAndNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId, nodeId, port: 443, sniOverride: 'not-served.example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('SNI_MISMATCH');
    // The orphan this whole shape exists to prevent: no screen lists bindings,
    // so one left here would be invisible and unremovable.
    const bindings = await app.inject({ method: 'GET', url: '/api/bindings', headers: auth() });
    expect(
      JSON.parse(bindings.body).bindings.filter((b: { nodeId: string }) => b.nodeId === nodeId),
    ).toHaveLength(0);
  });

  it('names the profile already holding the port', async () => {
    const a = await seedProfileAndNode();
    const b = await seedProfileAndNode();
    await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: a.profileId, nodeId: a.nodeId, port: 443 },
    });
    const clash = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: b.profileId, nodeId: a.nodeId, port: 443 },
    });
    expect(clash.statusCode).toBe(409);
  });

  it('rejects a body that gives neither a binding nor profile+node+port', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { remark: 'nowhere' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/users/:id', () => {
  it('returns the user by id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'findme' },
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${id}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).username).toBe('findme');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// A telegram id is not a person. In the operator's live data 151 telegram ids
// belong to more than one account and one belongs to 24 - families sharing a
// login, resellers holding several subscriptions under one chat. The lookup used
// to answer with an arbitrary match, so a bot acting on it acted on the wrong
// person's subscription, and the reply looked perfectly valid while doing it.
describe('lookups by a key that is not unique', () => {
  async function create(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload,
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body);
  }

  it('returns every account sharing a telegram id', async () => {
    await create({ username: 'family_dad', telegramId: '777000111' });
    await create({ username: 'family_kid', telegramId: '777000111' });
    await create({ username: 'someone_else', telegramId: '777000222' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-telegram-id/777000111',
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.users.map((u: { username: string }) => u.username).sort()).toEqual([
      'family_dad',
      'family_kid',
    ]);
  });

  // Oldest first, always: a caller that takes users[0] must get the same person
  // on every call, not whatever the database felt like returning.
  it('orders the list by creation, oldest first', async () => {
    const first = await create({ username: 'joined_first', telegramId: '888000111' });
    const second = await create({ username: 'joined_second', telegramId: '888000111' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-telegram-id/888000111',
      headers: auth(),
    });

    const ids = JSON.parse(res.body).users.map((u: { id: string }) => u.id);
    expect(ids).toEqual([first.id, second.id]);
  });

  // Nobody found is an empty list, not an error: "this chat has no subscription
  // yet" is a normal answer for a bot, and 404 would make it look like a fault.
  it('answers an unknown telegram id with an empty list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-telegram-id/999000999',
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ users: [], total: 0 });
  });

  // Username stays single, and this test says WHY: the column carries no unique
  // constraint, so the guarantee comes from createUser refusing a duplicate. If
  // that ever stops being true, this test fails and the lookup has to grow a
  // list like the two above.
  it('cannot have two accounts on one username, so the lookup stays single', async () => {
    await create({ username: 'twin' });
    const second = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'twin' },
    });
    expect(second.statusCode).toBe(409);

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-username/twin',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('twin');
    expect(body.users).toBeUndefined();
  });

  it('returns every account sharing an email', async () => {
    await create({ username: 'mail_one', email: 'shared@example.com' });
    await create({ username: 'mail_two', email: 'shared@example.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-email/shared@example.com',
      headers: auth(),
    });

    expect(JSON.parse(res.body).total).toBe(2);
  });

  // The one key that IS unique keeps the single-object shape: a token identifies
  // exactly one person, and that is the whole point of a token.
  it('still returns one object for a subscription token', async () => {
    const user = await create({ username: 'token_holder' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/by-subscription-token/${user.subscriptionToken}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('token_holder');
    expect(body.users).toBeUndefined();
  });

  it('still 404s on an unknown subscription token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/by-subscription-token/definitely-not-a-real-token',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/users/:id', () => {
  it('updates editable fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'editme' },
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/users/${id}`,
      headers: auth(),
      payload: { description: 'updated', tag: 'vip', status: 'disabled' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.description).toBe('updated');
    expect(body.tag).toBe('vip');
    expect(body.status).toBe('disabled');
  });

  it('rejects status values reserved for cron', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'badstatus' },
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/users/${id}`,
      headers: auth(),
      payload: { status: 'expired' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/users/:id', () => {
  it('soft-deletes the user', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'goner' },
    });
    const { id } = JSON.parse(created.body);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: `/api/users/${id}`,
      headers: auth(),
    });
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/users/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
