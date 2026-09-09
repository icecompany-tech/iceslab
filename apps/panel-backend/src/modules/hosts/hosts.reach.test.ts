import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * "N users reach it" has to mean N people.
 *
 * The hosts screen used to work it out by summing each squad's member count,
 * so one account in two squads was reported as two accounts. Spotted on a panel
 * that had exactly one user and showed "2 users reach it" on every host.
 *
 * The rows below pin the three ways that number can lie: the same person seen
 * twice, a deleted account still being counted, and a squad that holds the
 * profile but withholds this particular host.
 *
 * Every squad count here includes the seeded "All" squad, because creating a
 * profile auto-attaches it (slice 26 invariant, see profiles.service). It holds
 * the host and therefore counts as reaching it, while contributing no people:
 * these tests put users in explicit squads only.
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

const auth = () => ({ authorization: `Bearer ${token}` });

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers: auth(), payload });
  expect(res.statusCode, `${url} -> ${res.body}`).toBe(201);
  return JSON.parse(res.body);
}

async function seedHost(remark = 'Direct') {
  const profile = await post('/api/profiles', {
    name: `reach-profile-${remark}`,
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
  });
  const node = await post('/api/nodes', {
    name: `reach-node-${remark}`,
    address: `${remark.toLowerCase()}.example.com`,
    protocol: 'xray',
  });
  const host = await post('/api/hosts', {
    profileId: profile.id,
    nodeId: node.id,
    port: 443,
    remark,
  });
  return { profile, node, host };
}

async function reachOf(hostId: string) {
  const res = await app.inject({ method: 'GET', url: '/api/hosts', headers: auth() });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  const hosts: { id: string; reach?: { squads: number; users: number } }[] =
    body.hosts ?? body;
  const found = hosts.find((h) => h.id === hostId);
  expect(found, `host ${hostId} missing from the list`).toBeDefined();
  return found!.reach;
}

describe('host reach', () => {
  it('counts a person in two squads once', async () => {
    const { profile, host } = await seedHost();
    const first = await post('/api/squads', { name: 'tier-a', profileIds: [profile.id] });
    const second = await post('/api/squads', { name: 'tier-b', profileIds: [profile.id] });
    await post('/api/users', { username: 'reach_one', groupIds: [first.id, second.id] });

    // The regression: summing member counts across squads made this 2 users.
    // Squads are tier-a, tier-b and the auto-attached "All".
    expect(await reachOf(host.id)).toEqual({ squads: 3, users: 1 });
  });

  it('drops a deleted account from the count', async () => {
    const { profile, host } = await seedHost();
    const squad = await post('/api/squads', { name: 'tier-a', profileIds: [profile.id] });
    const user = await post('/api/users', { username: 'reach_gone', groupIds: [squad.id] });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${user.id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBeLessThan(300);

    // Deletion is soft and leaves the membership row behind, so counting
    // memberships rather than live accounts would still report 1 person here.
    expect(await reachOf(host.id)).toEqual({ squads: 2, users: 0 });
  });

  it('ignores a squad that withholds this host', async () => {
    const { profile, host } = await seedHost('Kept');
    // A second host on the same profile, so the squad has something to narrow to.
    const other = await post('/api/hosts', {
      bindingId: host.bindingId,
      port: 8443,
      remark: 'Withheld',
    });
    const squad = await post('/api/squads', {
      name: 'narrow',
      profileIds: [profile.id],
      hostIds: [other.id],
    });
    await post('/api/users', { username: 'reach_narrow', groupIds: [squad.id] });

    // The narrowing squad grants the profile but hands out only the other host,
    // so this one is reached by "All" alone, which has nobody in it. Counting
    // the narrowing squad here would promise reach a subscriber does not have.
    expect(await reachOf(host.id)).toEqual({ squads: 1, users: 0 });
    expect(await reachOf(other.id)).toEqual({ squads: 2, users: 1 });
  });
});
