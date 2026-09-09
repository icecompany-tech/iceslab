import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getRouteProfilesByEntryNode } from './cascade.service.js';

/**
 * Every node of an entry pool is a way into the cascade, so every one of them
 * must hand out the cascade's directions.
 *
 * Until 2026-08-15 this took the FIRST entry that matched and gave the profiles
 * to it alone. The others came back with nothing, and an endpoint with no
 * profiles is emitted as an ordinary direct server: the subscriber saw the
 * second entry as a plain node next to the cascade's lines, picked it, and
 * egressed from the ENTRY country instead of the exit they had chosen. On the
 * fleet where it was found that meant a Russian exit sold as Dutch.
 *
 * A DB test rather than a pure one because the seam that broke reads the
 * topology tables: the shape (a pool at position 0) is the entire point, and a
 * fake would have to reproduce exactly the thing that was wrong.
 */

let entryA: string;
let entryB: string;
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

/** A cascade stored ONLY in the v4 tables, which is what a pooled entry forces. */
async function pooledCascade(entryIds: string[], directions: { tag: number; nodeIds: string[] }[]) {
  const c = await prisma.cascade.create({
    data: { name: 'ru', enabled: true, mode: 'chain' },
    select: { id: true },
  });
  await prisma.cascadePosition.create({
    data: {
      cascadeId: c.id,
      position: 0,
      nodes: { create: entryIds.map((nodeId) => ({ nodeId })) },
    },
  });
  for (const d of directions) {
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

beforeEach(async () => {
  await cleanDatabase();
  entryA = await node('ru-01');
  entryB = await node('ru-02');
  exitNl = await node('nl-01');
  exitSe = await node('se-01');
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('route profiles for a pooled entry', () => {
  it('gives every entry of the pool the same directions', async () => {
    await pooledCascade(
      [entryA, entryB],
      [
        { tag: 1, nodeIds: [exitNl] },
        { tag: 2, nodeIds: [exitSe] },
      ],
    );

    const out = await getRouteProfilesByEntryNode([entryA, entryB, exitNl, exitSe]);

    // The regression: only entryA came back, and entryB was left to leak into
    // the subscription as a plain direct server.
    expect([...out.keys()].sort()).toEqual([entryA, entryB].sort());
    for (const id of [entryA, entryB]) {
      expect(out.get(id)!.map((p) => p.tag)).toEqual([1, 2]);
      expect(out.get(id)!.map((p) => p.label)).toEqual(
        expect.arrayContaining([expect.stringContaining('NL'), expect.stringContaining('SE')]),
      );
    }
  });

  it('labels a direction by where traffic leaves, pointing that way', async () => {
    await pooledCascade([entryA], [{ tag: 1, nodeIds: [exitNl] }]);
    const out = await getRouteProfilesByEntryNode([entryA]);
    // "ru · NL" was read as "ru through NL" by the first operator who saw it.
    expect(out.get(entryA)![0]!.label).toContain('ru → NL');
  });

  it('offers nothing for a direction whose pool is empty', async () => {
    // A direction with no node cannot connect; handing it out gives the
    // subscriber a server that fails rather than a country that is down.
    await pooledCascade([entryA], [{ tag: 1, nodeIds: [] }]);
    const out = await getRouteProfilesByEntryNode([entryA]);
    expect(out.has(entryA)).toBe(false);
  });

  it('says nothing about a node that is not an entry', async () => {
    await pooledCascade([entryA, entryB], [{ tag: 1, nodeIds: [exitNl] }]);
    const out = await getRouteProfilesByEntryNode([exitNl]);
    expect(out.size).toBe(0);
  });

  it('stops serving a disabled cascade', async () => {
    const id = await pooledCascade([entryA, entryB], [{ tag: 1, nodeIds: [exitNl] }]);
    await prisma.cascade.update({ where: { id }, data: { enabled: false } });
    expect((await getRouteProfilesByEntryNode([entryA, entryB])).size).toBe(0);
  });
});
