import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * What regenerating a profile's key would cost.
 *
 * The key is shared by every host of every binding, so a new pair is not a
 * field edit: it is a fleet-wide event with no undo, and every config already
 * in a subscriber's client stops authenticating the moment the nodes take it.
 * The confirm dialog counted hosts and nodes from lists the browser already
 * held and left the number that matters empty with an honest note, because the
 * subscriber side is a squad-ACL question only the panel can answer.
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
      name: `impact-${seq}`,
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
    payload: { name: `impact-node-${seq}`, address: `impact-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** A binding ships with one auto-created Default host. */
async function bind(profileId: string, nodeId: string, port: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
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
  return JSON.parse(res.body) as { id: string };
}

async function squadWith(profileIds: string[]): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/squads',
    headers: auth(),
    payload: { name: `impact-squad-${seq}`, profileIds },
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
    payload: { username: `imp_${seq}`, groupIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function impact(profileId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/profiles/${profileId}/key-impact`,
    headers: auth(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as {
    hosts: number;
    nodes: number;
    bindings: number;
    users: number;
    configs: number;
  };
}

describe('profile key impact', () => {
  it('counts nothing for a profile nobody is bound to', async () => {
    const profileId = await makeProfile();
    expect(await impact(profileId)).toEqual({
      hosts: 0,
      nodes: 0,
      bindings: 0,
      users: 0,
      configs: 0,
    });
  });

  it('counts every node the profile is deployed to', async () => {
    // Worth pinning: a profile can reach one node only ONCE
    // (@@unique([profileId, nodeId])), so "several bindings of one profile on
    // one node, on different ports" cannot happen, whatever the confirm dialog
    // guards against. Bindings and nodes therefore move together here.
    const profileId = await makeProfile();
    const a = await makeNode();
    const b = await makeNode();
    await bind(profileId, a, 443);
    await bind(profileId, b, 443);

    const i = await impact(profileId);
    expect(i.bindings).toBe(2);
    expect(i.nodes).toBe(2);
    expect(i.hosts).toBe(2);
  });

  it('refuses to double-bind one profile to one node, which is why nodes cannot be overcounted', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    await bind(profileId, nodeId, 443);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bindings',
      headers: auth(),
      payload: { profileId, nodeId, port: 8443 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('multiplies hosts by the subscribers who can reach them', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    await bind(profileId, nodeId, 443);
    await addHost(profileId, nodeId, 443, 'CDN');
    const groupId = await squadWith([profileId]);
    await subscriber([groupId]);
    await subscriber([groupId]);

    const i = await impact(profileId);
    expect(i.hosts).toBe(2);
    expect(i.users).toBe(2);
    expect(i.configs).toBe(4);
  });

  it('respects a squad that narrows its handout to one host', async () => {
    // The reason this is not users x hosts. A squad with GroupHost rows hands
    // out only those, so its members lose fewer configs than the arithmetic
    // would claim, and a confirm dialog that overstates the damage is as
    // useless as one that understates it.
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    await bind(profileId, nodeId, 443);
    const cdn = await addHost(profileId, nodeId, 443, 'CDN');
    const groupId = await squadWith([profileId]);
    await prisma.groupHost.create({ data: { groupId, hostId: cdn.id } });
    await subscriber([groupId]);

    const i = await impact(profileId);
    expect(i.hosts).toBe(2);
    expect(i.users).toBe(1);
    expect(i.configs).toBe(1);
  });

  it('counts a user in two squads once, over the union of what they see', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    await bind(profileId, nodeId, 443);
    const cdn = await addHost(profileId, nodeId, 443, 'CDN');
    const direct = await prisma.host.findFirstOrThrow({
      where: { binding: { profileId }, id: { not: cdn.id } },
      select: { id: true },
    });

    const squadA = await squadWith([profileId]);
    const squadB = await squadWith([profileId]);
    await prisma.groupHost.create({ data: { groupId: squadA, hostId: cdn.id } });
    await prisma.groupHost.create({ data: { groupId: squadB, hostId: direct.id } });
    await subscriber([squadA, squadB]);

    const i = await impact(profileId);
    expect(i.users).toBe(1);
    // Both halves of the union, counted once each.
    expect(i.configs).toBe(2);
  });

  it('ignores a disabled binding: it hands nothing out, so it costs nothing', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    const bindingId = await bind(profileId, nodeId, 443);
    const groupId = await squadWith([profileId]);
    await subscriber([groupId]);
    expect((await impact(profileId)).configs).toBe(1);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${bindingId}`,
      headers: auth(),
      payload: { enabled: false },
    });
    expect(res.statusCode, res.body).toBe(200);

    const i = await impact(profileId);
    expect(i.bindings).toBe(0);
    expect(i.hosts).toBe(0);
    expect(i.configs).toBe(0);
  });

  it('does not count a deleted subscriber', async () => {
    const profileId = await makeProfile();
    const nodeId = await makeNode();
    await bind(profileId, nodeId, 443);
    const groupId = await squadWith([profileId]);
    const userId = await subscriber([groupId]);
    expect((await impact(profileId)).users).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/users/${userId}`, headers: auth() });
    expect((await impact(profileId)).users).toBe(0);
  });

  it('404s for a profile that does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/profiles/00000000-0000-4000-8000-000000000000/key-impact',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
