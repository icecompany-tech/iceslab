import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { cascadeIsOffAt, getRouteProfilesByEntryNode, policiesForEntry } from './cascade.service.js';

/**
 * A squad hands a cascade out as one thing, with a switch.
 *
 * Three states per (squad, cascade), all on the one `exitAcl` list:
 *
 *   absent               every exit, as every squad had before;
 *   exitNodeIds: [nl]    only those exits;
 *   exitNodeIds: []      OFF: no line of the cascade is built for the squad,
 *                        even where it hands out the entry's host.
 *
 * Until 2026-09-24 the third one could not be said at all: the service dropped
 * an empty list and it read back as "absent", i.e. the exact opposite.
 */
let app: FastifyInstance;
let token: string;
let entry: string;
let exitNl: string;
let exitSe: string;
let cascadeId: string;

const auth = () => ({ authorization: `Bearer ${token}` });

async function node(name: string, countryCode: string): Promise<string> {
  const n = await prisma.node.create({
    data: { name, address: `${name}.example.com:1337`, protocol: 'xray', countryCode, heartbeatSecret: randomBytes(32) },
    select: { id: true },
  });
  return n.id;
}

async function squad(exitAcl?: { cascadeId: string; exitNodeIds: string[] }[]): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/squads',
    headers: auth(),
    payload: { name: `sq-${randomBytes(3).toString('hex')}`, ...(exitAcl ? { exitAcl } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const tags = (profiles: { tag: number }[] | undefined) => (profiles ?? []).map((p) => p.tag);

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  entry = await node('ru-01', 'RU');
  exitNl = await node('nl-01', 'NL');
  exitSe = await node('se-01', 'SE');
  const c = await prisma.cascade.create({
    data: { name: 'ru', enabled: true, mode: 'chain' },
    select: { id: true },
  });
  cascadeId = c.id;
  await prisma.cascadePosition.create({
    data: { cascadeId, position: 0, nodes: { create: [{ nodeId: entry }] } },
  });
  for (const [tag, nodeId] of [[1, exitNl], [2, exitSe]] as const) {
    await prisma.cascadeDirection.create({
      data: { cascadeId, tag, nodes: { create: [{ nodeId }] } },
    });
  }
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('the three states of a squad\'s exitAcl, as the subscription reads them', () => {
  it('absent: every direction', async () => {
    const g = await squad();
    const out = await getRouteProfilesByEntryNode([entry], [g]);
    expect(tags(out.get(entry))).toEqual([1, 2]);
  });

  it('a list: only those exits', async () => {
    const g = await squad([{ cascadeId, exitNodeIds: [exitNl] }]);
    const out = await getRouteProfilesByEntryNode([entry], [g]);
    expect(tags(out.get(entry))).toEqual([1]);
  });

  it('empty: the cascade is not built for the squad at all', async () => {
    const g = await squad([{ cascadeId, exitNodeIds: [] }]);
    const out = await getRouteProfilesByEntryNode([entry], [g]);
    // No entry in the map, which is what "not a cascade entry for this user"
    // looks like to the subscription.
    expect(out.has(entry)).toBe(false);
  });

  it('is kept on by another squad of the same user that hands the entry out', async () => {
    const off = await squad([{ cascadeId, exitNodeIds: [] }]);
    const open = await squad();
    const out = await getRouteProfilesByEntryNode([entry], [off, open]);
    expect(tags(out.get(entry))).toEqual([1, 2]);
  });

  it('is not kept on by a squad that does not hand the entry out', async () => {
    const off = await squad([{ cascadeId, exitNodeIds: [] }]);
    const elsewhere = await squad();
    // Only `off` reaches this entry: `elsewhere` has no say here.
    const reach = new Map([[entry, new Set([off])]]);
    const out = await getRouteProfilesByEntryNode([entry], [off, elsewhere], reach);
    expect(out.has(entry)).toBe(false);
  });
});

describe('exitAcl on the squad API', () => {
  const read = async (id: string) =>
    JSON.parse((await app.inject({ method: 'GET', url: `/api/squads/${id}`, headers: auth() })).body) as {
      exitAcl: { cascadeId: string; exitNodeIds: string[] }[];
    };
  const put = (id: string, exitAcl: unknown) =>
    app.inject({ method: 'PUT', url: `/api/squads/${id}`, headers: auth(), payload: { exitAcl } });

  it('stores an empty list and reads it back empty, not absent', async () => {
    const g = await squad([{ cascadeId, exitNodeIds: [] }]);
    expect((await read(g)).exitAcl).toEqual([{ cascadeId, exitNodeIds: [] }]);
  });

  it('moves between all three states on PUT, never holding two at once', async () => {
    const g = await squad();
    expect((await read(g)).exitAcl).toEqual([]);

    expect((await put(g, [{ cascadeId, exitNodeIds: [] }])).statusCode).toBe(200);
    expect((await read(g)).exitAcl).toEqual([{ cascadeId, exitNodeIds: [] }]);

    expect((await put(g, [{ cascadeId, exitNodeIds: [exitSe] }])).statusCode).toBe(200);
    expect((await read(g)).exitAcl).toEqual([{ cascadeId, exitNodeIds: [exitSe] }]);
    expect(await prisma.groupCascadeOff.count({ where: { groupId: g } })).toBe(0);

    expect((await put(g, [])).statusCode).toBe(200);
    expect((await read(g)).exitAcl).toEqual([]);
  });

  it('refuses two entries for one cascade', async () => {
    const g = await squad();
    const res = await put(g, [
      { cascadeId, exitNodeIds: [] },
      { cascadeId, exitNodeIds: [exitNl] },
    ]);
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe('cascadeIsOffAt and the policies of a squad that switched it off', () => {
  const reach = new Map([['e', new Set(['a', 'b'])]]);

  it('is off only when every speaking squad says so', () => {
    expect(cascadeIsOffAt({ groupIds: ['a'], entryNodeId: 'e', entryReach: reach, offGroups: new Set(['a']) })).toBe(true);
    expect(cascadeIsOffAt({ groupIds: ['a', 'b'], entryNodeId: 'e', entryReach: reach, offGroups: new Set(['a']) })).toBe(false);
    expect(cascadeIsOffAt({ groupIds: ['a', 'c'], entryNodeId: 'e', entryReach: reach, offGroups: new Set(['a']) })).toBe(true);
    expect(cascadeIsOffAt({ groupIds: ['a'], entryNodeId: 'e', entryReach: reach })).toBe(false);
    // Nobody speaking: nobody said off.
    expect(cascadeIsOffAt({ groupIds: ['c'], entryNodeId: 'e', entryReach: reach, offGroups: new Set(['c']) })).toBe(false);
  });

  it('takes no policy from the squad that switched the cascade off', () => {
    const policiesByGroup = new Map([
      ['a', [{ ordinal: 1, name: 'no ads' }]],
      ['b', [{ ordinal: 2, name: 'kids' }]],
    ]);
    const got = policiesForEntry({
      groupIds: ['a', 'b'],
      entryNodeId: 'e',
      policiesByGroup,
      entryReach: reach,
      offGroups: new Set(['a']),
    });
    expect(got.map((p) => p.ordinal)).toEqual([2]);
  });
});
