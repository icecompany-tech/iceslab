import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateSrrCache } from '../srr/srr.service.js';

/**
 * "What applies to this user", which is not what is written on their row.
 *
 * The routing preset falls through user -> squad -> panel default and the
 * format is picked per request from the client's User-Agent, so a card showing
 * the stored value shows the wrong thing for most people. The squad tier is the
 * one that goes wrong quietly: it is computed in the subscription service and
 * never left it, so "why is this one user routed differently" had no answer
 * short of reading the code.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  invalidateSrrCache();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
  invalidateSrrCache();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function squad(routingPreset: string | null): Promise<string> {
  seq += 1;
  const g = await prisma.group.create({ data: { name: `sq-${seq}`, routingPreset } });
  return g.id;
}

async function user(groupIds: string[]): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: auth(),
    payload: { username: `d_${seq}`, groupIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function delivery(id: string) {
  const res = await app.inject({ method: 'GET', url: `/api/users/${id}/delivery`, headers: auth() });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as {
    routing: {
      effective: string;
      source: string;
      user: string | null;
      squad: string | null;
      squadConflict: boolean;
      global: string;
    };
    format: {
      effective: string;
      source: string;
      ruleName: string | null;
      lastUserAgent: string | null;
      lastRequestedAt: string | null;
    };
  };
}

describe('effective routing preset', () => {
  it('falls through to the panel default when nothing overrides', async () => {
    const id = await user([await squad(null)]);
    const d = await delivery(id);
    expect(d.routing.source).toBe('global');
    expect(d.routing.effective).toBe(d.routing.global);
    expect(d.routing.user).toBeNull();
    expect(d.routing.squad).toBeNull();
  });

  it('takes the squad override and says the squad decided it', async () => {
    const id = await user([await squad('ru-split')]);
    const d = await delivery(id);
    expect(d.routing.effective).toBe('ru-split');
    expect(d.routing.source).toBe('squad');
    expect(d.routing.squad).toBe('ru-split');
  });

  it('lets the per-user override win over the squad', async () => {
    const id = await user([await squad('ru-split')]);
    await prisma.user.update({ where: { id }, data: { routingPreset: 'cn-split' } });
    const d = await delivery(id);
    expect(d.routing.effective).toBe('cn-split');
    expect(d.routing.source).toBe('user');
    // The squad's value is still reported: the card has to be able to say what
    // the user would fall back to if the override were removed.
    expect(d.routing.squad).toBe('ru-split');
  });

  it('reports disagreeing squads as a conflict instead of as "no override"', async () => {
    // resolveSquadRouting answers null for both cases, which is right for
    // serving and wrong for a screen: one is ordinary, the other is a
    // misconfiguration somebody has to fix.
    const id = await user([await squad('ru-split'), await squad('cn-split')]);
    const d = await delivery(id);
    expect(d.routing.squadConflict).toBe(true);
    expect(d.routing.squad).toBeNull();
    expect(d.routing.source).toBe('global');
  });

  it('two squads naming the SAME preset is not a conflict', async () => {
    const id = await user([await squad('ru-split'), await squad('ru-split')]);
    const d = await delivery(id);
    expect(d.routing.squadConflict).toBe(false);
    expect(d.routing.effective).toBe('ru-split');
  });
});

describe('effective subscription format', () => {
  it('is the panel fallback for a user whose client has never called', async () => {
    const id = await user([]);
    const d = await delivery(id);
    expect(d.format.effective).toBe('plain');
    expect(d.format.source).toBe('default');
    expect(d.format.lastUserAgent).toBeNull();
  });

  it('resolves the last real request through the SRR rules and names the rule', async () => {
    // A format on its own is an assertion nobody can check. The rule name is
    // something an operator can open and edit.
    await prisma.subscriptionResponseRule.create({
      data: { name: 'Happ', uaPattern: '(?i)happ', format: 'xrayjson', priority: 10 },
    });
    invalidateSrrCache();
    const id = await user([]);
    await prisma.subscriptionRequestHistory.create({
      data: { userId: id, userAgent: 'Happ/1.0 iOS' },
    });

    const d = await delivery(id);
    expect(d.format.effective).toBe('xrayjson');
    expect(d.format.source).toBe('srr');
    expect(d.format.ruleName).toBe('Happ');
    expect(d.format.lastUserAgent).toBe('Happ/1.0 iOS');
    expect(d.format.lastRequestedAt).not.toBeNull();
  });

  it('reads the LATEST request, not the first one', async () => {
    await prisma.subscriptionResponseRule.create({
      data: { name: 'Clash', uaPattern: '(?i)clash', format: 'clash', priority: 10 },
    });
    invalidateSrrCache();
    const id = await user([]);
    await prisma.subscriptionRequestHistory.create({
      data: { userId: id, userAgent: 'clash-verge', requestedAt: new Date(Date.now() - 60_000) },
    });
    await prisma.subscriptionRequestHistory.create({
      data: { userId: id, userAgent: 'curl/8.0', requestedAt: new Date() },
    });

    const d = await delivery(id);
    expect(d.format.lastUserAgent).toBe('curl/8.0');
    expect(d.format.source).toBe('default');
  });

  it('404s for a user who does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/00000000-0000-4000-8000-000000000000/delivery',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
