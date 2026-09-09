import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { registerBindingsCacheBust } from './subscription.bindings-cache.js';
import { invalidateSubscriptionSettingsCache } from '../settings/settings.service.js';

/**
 * A node an operator deployed has to show up in subscriptions.
 *
 * The entry pool used to be a hard-coded three per profile, which meant a
 * healthy, serving node could be missing from a subscription with nothing
 * anywhere explaining why. It was reported as a bug, correctly: from the
 * operator's chair the node had simply stopped working.
 *
 * So the default hands out everything, and the cap is opt-in. These rows pin
 * both halves, because the interesting failure is silent either way: a
 * regression to a default cap hides nodes, and a broken cap publishes the whole
 * entry surface to an operator who asked us not to.
 */
let app: FastifyInstance;
let token: string;

beforeAll(() => registerBindingsCacheBust());

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  invalidateSubscriptionSettingsCache();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
  invalidateSubscriptionSettingsCache();
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

/** One profile on four nodes, one squad, one user. */
async function seedFleet() {
  const profile = await post('/api/profiles', {
    name: 'pool-profile',
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
  for (const name of ['pool-a', 'pool-b', 'pool-c', 'pool-d']) {
    const node = await post('/api/nodes', {
      name,
      address: `${name}.example.com`,
      protocol: 'xray',
    });
    await post('/api/hosts', {
      profileId: profile.id,
      nodeId: node.id,
      port: 443,
      remark: name,
    });
  }
  const squad = await post('/api/squads', { name: 'pool-squad', profileIds: [profile.id] });
  const user = await post('/api/users', { username: 'pool_user', groupIds: [squad.id] });
  return { profile, squad, user };
}

async function entryNames(subToken: string): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/sub/${subToken}?format=plain` });
  expect(res.statusCode).toBe(200);
  return Buffer.from(res.body, 'base64')
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((uri) => decodeURIComponent(uri.split('#')[1] ?? ''))
    .sort();
}

/** Unsorted, because which entry comes FIRST is the thing under test here. */
async function firstEntry(subToken: string): Promise<string | undefined> {
  const res = await app.inject({ method: 'GET', url: `/sub/${subToken}?format=plain` });
  expect(res.statusCode).toBe(200);
  const uri = Buffer.from(res.body, 'base64').toString('utf8').split('\n').filter(Boolean)[0];
  return uri ? decodeURIComponent(uri.split('#')[1] ?? '') : undefined;
}

async function setPoolSize(size: number) {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth(),
    payload: { subscriptionEntryPoolSize: size },
  });
  expect(res.statusCode, res.body).toBeLessThan(300);
}

describe('entry pool', () => {
  it('hands out every node by default', async () => {
    const { user } = await seedFleet();
    // The regression this guards: a hard-coded cap of three silently dropped
    // the fourth node, and an operator has no way to tell that from a fault.
    expect(await entryNames(user.subscriptionToken)).toEqual([
      'pool-a',
      'pool-b',
      'pool-c',
      'pool-d',
    ]);
  });

  it('caps entries per profile when the operator asks for it', async () => {
    const { user } = await seedFleet();
    await setPoolSize(2);
    const names = await entryNames(user.subscriptionToken);
    expect(names).toHaveLength(2);
    // Stable across refreshes: a subscriber's router must not wander between
    // entries every time it polls.
    expect(await entryNames(user.subscriptionToken)).toEqual(names);
  });

  it('treats a cap of zero as no cap', async () => {
    const { user } = await seedFleet();
    await setPoolSize(0);
    expect(await entryNames(user.subscriptionToken)).toHaveLength(4);
  });

  it('hands out everything when the cap exceeds the fleet', async () => {
    const { user } = await seedFleet();
    await setPoolSize(10);
    expect(await entryNames(user.subscriptionToken)).toHaveLength(4);
  });

  it('starts different subscribers on different nodes', async () => {
    const { squad } = await seedFleet();
    // Handing everyone the same order would send the whole userbase to whichever
    // node the query returned first, since clients dial the first entry and few
    // subscribers ever pick another. Ten users over four nodes: landing on one
    // node every time would be a one-in-a-quarter-million coincidence, so a
    // single distinct first entry here means the ordering stopped being
    // per-user, not that we got unlucky.
    const firsts = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const u = await post('/api/users', { username: `spread_${i}`, groupIds: [squad.id] });
      firsts.add((await firstEntry(u.subscriptionToken))!);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('keeps a subscriber on the same first node across refreshes', async () => {
    const { user } = await seedFleet();
    const first = await firstEntry(user.subscriptionToken);
    expect(await firstEntry(user.subscriptionToken)).toBe(first);
    expect(await firstEntry(user.subscriptionToken)).toBe(first);
  });
});
