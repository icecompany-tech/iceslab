import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * Who is still holding the old link.
 *
 * Nothing breaks at the moment a host, its binding or its profile is edited:
 * the subscriber keeps connecting on the config they already have until it
 * stops authenticating, and then finds out on their own. The screen exists to
 * get ahead of that, which only works if the number is right.
 *
 * Every assertion here would pass with a plausible wrong number, so each one
 * pins a specific way of being wrong: counting memberships instead of people,
 * anchoring on the host row alone, or calling a poll from before the edit
 * "current".
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function makeProfile(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: {
      name: `fresh-${seq}`,
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
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function makeNode(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `fresh-node-${seq}`, address: `fresh-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function addHost(profileId: string, nodeId: string, port: number, remark: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/hosts',
    headers: auth(),
    payload: { profileId, nodeId, port, remark },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string; bindingId: string };
}

async function squadWith(profileIds: string[]): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/squads',
    headers: auth(),
    payload: { name: `fresh-squad-${seq}`, profileIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function subscriber(groupIds: string[]): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: auth(),
    payload: { username: `fr_${seq}`, groupIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** A client polling /sub, which is what the freshness answer is read out of. */
async function polled(userId: string, when: Date): Promise<void> {
  await prisma.subscriptionRequestHistory.create({
    data: { userId, requestedAt: when },
  });
}

async function freshness(hostId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/hosts/${hostId}/freshness`,
    headers: auth(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as {
    configChangedAt: string;
    current: number;
    stale: number;
    total: number;
    neverFetched: number;
    retentionDays: number;
  };
}

describe('host freshness', () => {
  it('counts a subscriber who has never polled as stale, and says so separately', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    await subscriber([groupId]);

    const f = await freshness(host.id);
    expect(f.total).toBe(1);
    expect(f.stale).toBe(1);
    expect(f.current).toBe(0);
    expect(f.neverFetched).toBe(1);
    expect(f.retentionDays).toBe(90);
  });

  it('a poll after the change makes the subscriber current', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);

    const before = await freshness(host.id);
    await polled(userId, new Date(new Date(before.configChangedAt).getTime() + 1000));

    const f = await freshness(host.id);
    expect(f.current).toBe(1);
    expect(f.stale).toBe(0);
    expect(f.neverFetched).toBe(0);
  });

  it('a poll from BEFORE the change leaves them stale, and is not "never fetched"', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);
    await polled(userId, new Date(Date.now() - 3600_000));

    const f = await freshness(host.id);
    expect(f.stale).toBe(1);
    expect(f.current).toBe(0);
    // They have the app and they have polled; they simply have the old link.
    expect(f.neverFetched).toBe(0);
  });

  it('editing the BINDING resets everybody to stale, though the host row never moved', async () => {
    // The case the host's own updatedAt cannot see, and the reason
    // configChangedAt takes the max of three rows. "Порт поменяли в среду" is
    // an edit to the binding.
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);
    await polled(userId, new Date());
    expect((await freshness(host.id)).current).toBe(1);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${host.bindingId}`,
      headers: auth(),
      payload: { port: 8443 },
    });
    expect(res.statusCode, res.body).toBe(200);

    const f = await freshness(host.id);
    expect(f.current).toBe(0);
    expect(f.stale).toBe(1);
  });

  it('editing the PROFILE does the same', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);
    await polled(userId, new Date());
    expect((await freshness(host.id)).current).toBe(1);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profileId}`,
      headers: auth(),
      payload: { description: 'edited' },
    });
    expect(res.statusCode, res.body).toBe(200);

    expect((await freshness(host.id)).stale).toBe(1);
  });

  it('counts a person in two squads once', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const a = await squadWith([profileId]);
    const b = await squadWith([profileId]);
    await subscriber([a, b]);

    const f = await freshness(host.id);
    expect(f.total).toBe(1);
    expect(f.stale).toBe(1);
  });

  it('leaves out a squad that narrows its handout to another host', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const direct = await addHost(profileId, nodeId, 443, 'Direct');
    const cdn = await addHost(profileId, nodeId, 443, 'CDN');
    const groupId = await squadWith([profileId]);
    await prisma.groupHost.create({ data: { groupId, hostId: cdn.id } });
    await subscriber([groupId]);

    // That squad hands out the CDN host only, so nobody holds a link to the
    // direct one and changing it costs nothing.
    expect((await freshness(direct.id)).total).toBe(0);
    expect((await freshness(cdn.id)).total).toBe(1);
  });

  it('does not count a deleted subscriber', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);
    expect((await freshness(host.id)).total).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/users/${userId}`, headers: auth() });
    expect((await freshness(host.id)).total).toBe(0);
  });

  it('the host DTO carries configChangedAt, and it is not the host row stamp', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const host = await addHost(profileId, nodeId, 443, 'Direct');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${host.bindingId}`,
      headers: auth(),
      payload: { port: 8443 },
    });
    expect(res.statusCode, res.body).toBe(200);

    const dto = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/hosts/${host.id}`, headers: auth() })).body,
    ) as { updatedAt: string; configChangedAt: string };
    expect(new Date(dto.configChangedAt) > new Date(dto.updatedAt)).toBe(true);
  });

  it('404s for a host that does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/hosts/00000000-0000-4000-8000-000000000000/freshness',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
