import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateHiddenCascadeNodeCache } from '../cascades/cascade.service.js';

/**
 * A host nobody will be handed, said out loud.
 *
 * POST /api/hosts on a node that is the transit or the exit of an enabled
 * cascade answered 201 and stayed silent, while the subscription drops that
 * node for everyone: users reach it through the cascade's entry only. Not a
 * refusal, the operator may prepare a host for later, so the answer carries the
 * FACT, and from the same function the subscription filters with, so the two
 * cannot disagree about which hosts are out.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  // The hidden set is cached in-process for a minute; a cascade from the
  // previous test would otherwise still be "hiding" nodes that no longer exist.
  invalidateHiddenCascadeNodeCache();
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

async function node(name: string) {
  return post('/api/nodes', { name, address: `${name}.example.com`, protocol: 'xray' });
}

async function cascade(name: string, entry: string, exit: string, extra: Record<string, unknown> = {}) {
  return post('/api/cascades', {
    name,
    enabled: true,
    positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' }],
    directions: [{ tag: 1, countryCode: 'NL', nodeIds: [exit] }],
    ...extra,
  });
}

async function hostOn(nodeId: string, port: number) {
  const profile = await post('/api/profiles', { name: `hy-${port}`, protocol: 'hysteria', config: {} });
  return post('/api/hosts', { profileId: profile.id, nodeId, port, remark: `h-${port}` });
}

describe('hiddenByCascade on a host', () => {
  it('names the cascade on a host at its exit, and null at its entry, on create and on the list', async () => {
    const ru = await node('ru');
    const nl = await node('nl');
    const c = await cascade('ru-out', ru.id, nl.id);

    // Still 201: a fact, not a refusal.
    const atExit = await hostOn(nl.id, 443);
    const atEntry = await hostOn(ru.id, 8443);
    expect(atExit.hiddenByCascade).toEqual({ cascadeId: c.id, cascadeName: 'ru-out' });
    expect(atEntry.hiddenByCascade).toBeNull();

    const list = await app.inject({ method: 'GET', url: '/api/hosts', headers: auth() });
    const byId = new Map(
      (JSON.parse(list.body).hosts as { id: string; hiddenByCascade: unknown }[]).map((h) => [h.id, h]),
    );
    expect(byId.get(atExit.id)?.hiddenByCascade).toEqual({ cascadeId: c.id, cascadeName: 'ru-out' });
    expect(byId.get(atEntry.id)?.hiddenByCascade).toBeNull();

    const one = await app.inject({ method: 'GET', url: `/api/hosts/${atExit.id}`, headers: auth() });
    expect(JSON.parse(one.body).hiddenByCascade).toEqual({ cascadeId: c.id, cascadeName: 'ru-out' });
  });

  it('agrees with the subscription about who is out', async () => {
    // The point of computing it with the same function: the screen must never
    // call a host visible that the subscription drops, or the other way round.
    const ru = await node('ru');
    const nl = await node('nl');
    await cascade('ru-out', ru.id, nl.id);
    await hostOn(nl.id, 443);
    await hostOn(ru.id, 8443);
    const user = await post('/api/users', { username: 'hidden-check' });

    const sub = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
      headers: { accept: 'application/json' },
    });
    const nodeIds = new Set((JSON.parse(sub.body).endpoints as { nodeId: string }[]).map((e) => e.nodeId));
    expect(nodeIds.has(ru.id)).toBe(true);
    expect(nodeIds.has(nl.id)).toBe(false);
  });

  it('is null where the cascade does not hide: switched off, or hops left visible', async () => {
    const ru = await node('ru');
    const nl = await node('nl');
    const de = await node('de');
    const ua = await node('ua');
    await cascade('off', ru.id, nl.id, { enabled: false });
    await cascade('shown', de.id, ua.id, { hideHopsFromSub: false });

    expect((await hostOn(nl.id, 443)).hiddenByCascade).toBeNull();
    expect((await hostOn(ua.id, 444)).hiddenByCascade).toBeNull();
  });
});
