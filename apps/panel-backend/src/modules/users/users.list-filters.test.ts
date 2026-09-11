import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { ONLINE_WINDOW_MS } from '@iceslab/shared';

/**
 * The roster shows 23 columns and could narrow by five of them.
 *
 * The frontend deliberately draws no filter where the endpoint cannot narrow:
 * a control that sorts the current page answers a different question (25 rows
 * out of ten thousand) and a disabled one reads as breakage. So every column
 * that became filterable here is a header that lights up, and every one of them
 * has to come back with the right rows or an operator acts on a wrong list.
 *
 * Two of these tests exist because of how the filters are ASSEMBLED rather than
 * what any one of them does: several narrow the same `traffic` relation, and
 * written as one object literal the last key would silently win.
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

async function makeNode(name: string): Promise<string> {
  const n = await prisma.node.create({
    data: { name, address: `${name}.test:1337`, heartbeatSecret: Buffer.alloc(32) },
  });
  return n.id;
}

interface UserOpts {
  username?: string;
  expireAt?: Date | null;
  trafficLimitBytes?: bigint | null;
  hwidDeviceLimit?: number | null;
  telegramId?: bigint | null;
  email?: string | null;
  tag?: string | null;
  subRevokedAt?: Date | null;
  onlineAt?: Date | null;
  firstConnectedAt?: Date | null;
  lastConnectedNodeId?: string | null;
  usedTrafficBytes?: bigint;
}

async function makeUser(opts: UserOpts = {}): Promise<{ id: string; username: string }> {
  seq += 1;
  const username = opts.username ?? `u_${seq}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: auth(),
    payload: { username },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = JSON.parse(res.body).id as string;

  await prisma.user.update({
    where: { id },
    data: {
      ...(opts.expireAt !== undefined ? { expireAt: opts.expireAt } : {}),
      ...(opts.trafficLimitBytes !== undefined ? { trafficLimitBytes: opts.trafficLimitBytes } : {}),
      ...(opts.hwidDeviceLimit !== undefined ? { hwidDeviceLimit: opts.hwidDeviceLimit } : {}),
      ...(opts.telegramId !== undefined ? { telegramId: opts.telegramId } : {}),
      ...(opts.email !== undefined ? { email: opts.email } : {}),
      ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
      ...(opts.subRevokedAt !== undefined ? { subRevokedAt: opts.subRevokedAt } : {}),
    },
  });

  const touchesTraffic =
    opts.onlineAt !== undefined ||
    opts.firstConnectedAt !== undefined ||
    opts.lastConnectedNodeId !== undefined ||
    opts.usedTrafficBytes !== undefined;
  if (touchesTraffic) {
    await prisma.userTraffic.upsert({
      where: { userId: id },
      create: {
        userId: id,
        onlineAt: opts.onlineAt ?? null,
        firstConnectedAt: opts.firstConnectedAt ?? null,
        lastConnectedNodeId: opts.lastConnectedNodeId ?? null,
        usedTrafficBytes: opts.usedTrafficBytes ?? 0n,
      },
      update: {
        onlineAt: opts.onlineAt ?? null,
        firstConnectedAt: opts.firstConnectedAt ?? null,
        lastConnectedNodeId: opts.lastConnectedNodeId ?? null,
        usedTrafficBytes: opts.usedTrafficBytes ?? 0n,
      },
    });
  }
  return { id, username };
}

async function listed(query: string): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/api/users?${query}`, headers: auth() });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body).users as { username: string }[]).map((u) => u.username);
}

const ago = (ms: number) => new Date(Date.now() - ms);

describe('what the roster hands back about a connection', () => {
  it('names the node the user was last seen on, not just its id', async () => {
    // The id alone is unreadable in a table cell, and resolving it client-side
    // would be a second request per page.
    const nodeId = await makeNode('de-1');
    const first = ago(90 * 24 * 3600 * 1000);
    await makeUser({
      username: 'seen',
      lastConnectedNodeId: nodeId,
      firstConnectedAt: first,
      onlineAt: ago(1000),
    });

    const res = await app.inject({ method: 'GET', url: '/api/users', headers: auth() });
    const user = (JSON.parse(res.body).users as Record<string, unknown>[]).find(
      (u) => u.username === 'seen',
    )!;
    expect(user.lastConnectedNodeId).toBe(nodeId);
    expect(user.lastConnectedNodeName).toBe('de-1');
    expect(user.firstConnectedAt).toBe(first.toISOString());
  });

  it('says null for a user no node has ever seen, without inventing a name', async () => {
    await makeUser({ username: 'fresh' });
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: auth() });
    const user = (JSON.parse(res.body).users as Record<string, unknown>[]).find(
      (u) => u.username === 'fresh',
    )!;
    expect(user.lastConnectedNodeId).toBeNull();
    expect(user.lastConnectedNodeName).toBeNull();
    expect(user.firstConnectedAt).toBeNull();
  });
});

describe('filters the roster headers turn on', () => {
  it('nodeId keeps the users of that node, and `none` the ones nobody has seen', async () => {
    const de = await makeNode('de-1');
    const nl = await makeNode('nl-1');
    await makeUser({ username: 'on_de', lastConnectedNodeId: de });
    await makeUser({ username: 'on_nl', lastConnectedNodeId: nl });
    await makeUser({ username: 'nowhere' });

    expect(await listed(`nodeId=${de}`)).toEqual(['on_de']);
    expect(await listed('nodeId=none')).toEqual(['nowhere']);
  });

  it('online, offline and never are three answers, not two', async () => {
    // Never-connected is the interesting cohort, a sold subscription nobody
    // installed. Folding it into `offline` would hide it.
    await makeUser({ username: 'now', onlineAt: ago(1000) });
    await makeUser({ username: 'lapsed', onlineAt: ago(ONLINE_WINDOW_MS * 4) });
    await makeUser({ username: 'never_seen' });

    expect(await listed('online=online')).toEqual(['now']);
    expect(await listed('online=offline')).toEqual(['lapsed']);
    expect(await listed('online=never')).toEqual(['never_seen']);
  });

  it('narrows by an expiry window, and separately by having one at all', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const later = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    await makeUser({ username: 'soon', expireAt: soon });
    await makeUser({ username: 'later', expireAt: later });
    await makeUser({ username: 'forever', expireAt: null });

    const weekOut = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    expect(await listed(`expiresBefore=${encodeURIComponent(weekOut)}`)).toEqual(['soon']);
    expect(await listed('hasExpiry=no')).toEqual(['forever']);
    expect((await listed('hasExpiry=yes')).sort()).toEqual(['later', 'soon']);
  });

  it('separates a quota from unlimited, and narrows by bytes used', async () => {
    await makeUser({ username: 'capped', trafficLimitBytes: 100n, usedTrafficBytes: 90n });
    await makeUser({ username: 'unlimited', trafficLimitBytes: null, usedTrafficBytes: 5n });

    expect(await listed('trafficLimit=limited')).toEqual(['capped']);
    expect(await listed('trafficLimit=unlimited')).toEqual(['unlimited']);
    expect(await listed('usedOver=50')).toEqual(['capped']);
    expect(await listed('usedUnder=10')).toEqual(['unlimited']);
  });

  it('answers the two-state columns: device cap, telegram, email, revoked, tag', async () => {
    await makeUser({
      username: 'rich',
      hwidDeviceLimit: 3,
      telegramId: 777n,
      email: 'a@example.com',
      tag: 'vip',
      subRevokedAt: new Date(),
    });
    await makeUser({ username: 'bare' });

    expect(await listed('deviceLimit=set')).toEqual(['rich']);
    expect(await listed('deviceLimit=unset')).toEqual(['bare']);
    expect(await listed('telegram=linked')).toEqual(['rich']);
    expect(await listed('telegram=none')).toEqual(['bare']);
    expect(await listed('email=set')).toEqual(['rich']);
    expect(await listed('email=none')).toEqual(['bare']);
    expect(await listed('revoked=yes')).toEqual(['rich']);
    expect(await listed('revoked=no')).toEqual(['bare']);
    expect(await listed('hasTag=yes')).toEqual(['rich']);
    expect(await listed('hasTag=no')).toEqual(['bare']);
  });

  it('combines two filters on the same relation instead of letting one win', async () => {
    // nodeId and online both narrow `traffic`. Assembled as one object literal
    // the second key overwrites the first, and the operator gets a list that
    // ignored half of what they asked for, with nothing saying so.
    const de = await makeNode('de-1');
    const nl = await makeNode('nl-1');
    await makeUser({ username: 'de_now', lastConnectedNodeId: de, onlineAt: ago(1000) });
    await makeUser({
      username: 'de_lapsed',
      lastConnectedNodeId: de,
      onlineAt: ago(ONLINE_WINDOW_MS * 4),
    });
    await makeUser({ username: 'nl_now', lastConnectedNodeId: nl, onlineAt: ago(1000) });

    expect(await listed(`nodeId=${de}&online=online`)).toEqual(['de_now']);
  });

  it('combines a user-row filter with a relation one', async () => {
    const de = await makeNode('de-1');
    await makeUser({ username: 'de_capped', lastConnectedNodeId: de, trafficLimitBytes: 10n });
    await makeUser({ username: 'de_free', lastConnectedNodeId: de, trafficLimitBytes: null });

    expect(await listed(`nodeId=${de}&trafficLimit=limited`)).toEqual(['de_capped']);
  });

  it('finds a user by short id and by telegram id, which the box promised and did not do', async () => {
    const { id } = await makeUser({ username: 'findme', telegramId: 123456789n });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { shortId: true },
    });

    expect(await listed(`search=${row.shortId}`)).toEqual(['findme']);
    expect(await listed('search=123456789')).toEqual(['findme']);
  });

  it('a search term that is not a number does not blow up on the bigint column', async () => {
    await makeUser({ username: 'plain_user' });
    expect(await listed('search=plain')).toEqual(['plain_user']);
  });

  it('sorts by the columns that only got a sort now', async () => {
    await makeUser({ username: 'older', firstConnectedAt: ago(10_000), onlineAt: ago(10_000) });
    await makeUser({ username: 'newer', firstConnectedAt: ago(1_000), onlineAt: ago(1_000) });

    expect(await listed('sort=firstConnected&order=desc')).toEqual(['newer', 'older']);
    expect(await listed('sort=lastOnline&order=asc')).toEqual(['older', 'newer']);
  });

  it('rejects a filter value it does not know rather than ignoring it', async () => {
    // Silently dropping an unknown value would hand back the unfiltered roster,
    // which reads as "the filter found everything".
    const res = await app.inject({
      method: 'GET',
      url: '/api/users?online=maybe',
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });
});
