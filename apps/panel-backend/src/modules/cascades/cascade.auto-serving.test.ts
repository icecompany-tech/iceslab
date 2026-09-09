import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getRouteProfilesByEntryNode } from './cascade.service.js';
import { autoRouteTag } from './cascade.config.js';

/**
 * Who gets the Auto line, and who must not.
 *
 * The line itself is easy; the gate is the part worth pinning. A squad's exit
 * allow-list is enforced entirely by which TAGS a user is handed, and Auto names
 * no exit: the entry's balancer spans every direction, because one node runs one
 * config for everybody. Hand Auto to a user restricted to the Dutch exit and
 * they leave through Sweden while the panel still shows the restriction as
 * applied.
 *
 * DB-backed on purpose: the flag, the directions and the squad ACL are three
 * tables that have to agree, and a fake would agree by construction.
 */

let entry: string;
let exitNl: string;
let exitSe: string;

async function node(name: string): Promise<string> {
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}.example.com:1337`,
      protocol: 'xray',
      countryCode: name.startsWith('nl') ? 'NL' : name.startsWith('se') ? 'SE' : 'RU',
      heartbeatSecret: randomBytes(32),
    },
    select: { id: true },
  });
  return n.id;
}

async function cascade(opts: {
  autoProfile: boolean;
  directions: { tag: number; nodeIds: string[] }[];
}): Promise<string> {
  const c = await prisma.cascade.create({
    data: { name: 'ru', enabled: true, mode: 'chain', autoProfile: opts.autoProfile },
    select: { id: true },
  });
  await prisma.cascadePosition.create({
    data: { cascadeId: c.id, position: 0, nodes: { create: [{ nodeId: entry }] } },
  });
  for (const d of opts.directions) {
    await prisma.cascadeDirection.create({
      data: {
        cascadeId: c.id,
        tag: d.tag,
        nodes: { create: d.nodeIds.map((nodeId) => ({ nodeId })) },
      },
    });
  }
  return c.id;
}

/** A squad that may only leave through the nodes it names. */
async function restrictedSquad(cascadeId: string, exitNodeIds: string[]): Promise<string> {
  const g = await prisma.group.create({ data: { name: `squad-${randomBytes(4).toString('hex')}` }, select: { id: true } });
  for (const exitNodeId of exitNodeIds) {
    await prisma.groupCascadeExit.create({ data: { groupId: g.id, cascadeId, exitNodeId } });
  }
  return g.id;
}

const tags = (profiles: { tag: number }[] | undefined) => (profiles ?? []).map((p) => p.tag);

beforeEach(async () => {
  await cleanDatabase();
  entry = await node('ru-01');
  exitNl = await node('nl-01');
  exitSe = await node('se-01');
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('the Auto line in a subscription', () => {
  it('leads the list when the operator turned it on', async () => {
    await cascade({
      autoProfile: true,
      directions: [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    });
    const out = await getRouteProfilesByEntryNode([entry]);
    const profiles = out.get(entry)!;
    // First, because it is the row most subscribers should be using.
    expect(profiles[0]!.tag).toBe(autoRouteTag(0));
    expect(profiles[0]!.label).toContain('Auto');
    // And the countries stay: Auto is an addition, not a replacement.
    expect(tags(profiles)).toEqual([autoRouteTag(0), 1, 2]);
  });

  it('is absent while the switch is off', async () => {
    await cascade({
      autoProfile: false,
      directions: [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    });
    const out = await getRouteProfilesByEntryNode([entry]);
    expect(tags(out.get(entry))).toEqual([1, 2]);
  });

  it('is absent with one direction, where it would repeat the row above it', async () => {
    await cascade({ autoProfile: true, directions: [{ tag: 1, nodeIds: [exitNl] }] });
    const out = await getRouteProfilesByEntryNode([entry]);
    expect(tags(out.get(entry))).toEqual([1]);
  });

  it('counts only directions that have a node behind them', async () => {
    // Two directions on paper, one that can actually carry traffic. The
    // balancer would have a single member, so Auto is the same row twice.
    await cascade({
      autoProfile: true,
      directions: [{ tag: 1, nodeIds: [exitNl] }, { tag: 2, nodeIds: [] }],
    });
    const out = await getRouteProfilesByEntryNode([entry]);
    expect(tags(out.get(entry))).toEqual([1]);
  });

  it('is withheld from a squad that restricts exits', async () => {
    const id = await cascade({
      autoProfile: true,
      directions: [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    });
    const squad = await restrictedSquad(id, [exitNl]);

    const out = await getRouteProfilesByEntryNode([entry], [squad]);
    const profiles = out.get(entry)!;
    // The allow-list still does its job: only the Dutch direction.
    expect(tags(profiles)).toEqual([1]);
    // And Auto is not smuggled past it. This is the assertion the feature
    // exists to satisfy: Auto can leave through Sweden, so a user who may not
    // leave through Sweden does not get Auto.
    expect(tags(profiles)).not.toContain(autoRouteTag(0));
  });

  it('reaches a squad that restricts nothing', async () => {
    await cascade({
      autoProfile: true,
      directions: [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    });
    // A squad with no allow-rows is unrestricted, the panel's existing opt-in
    // convention. Reading "has a squad" as "is restricted" would have hidden
    // Auto from nearly everybody.
    const open = await prisma.group.create({ data: { name: 'open' }, select: { id: true } });

    const out = await getRouteProfilesByEntryNode([entry], [open.id]);
    expect(tags(out.get(entry))).toEqual([autoRouteTag(0), 1, 2]);
  });

  it('keeps the Auto tag clear of every direction tag', async () => {
    await cascade({
      autoProfile: true,
      directions: [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    });
    const profiles = (await getRouteProfilesByEntryNode([entry])).get(entry)!;
    expect(new Set(tags(profiles)).size).toBe(profiles.length);
  });
});
