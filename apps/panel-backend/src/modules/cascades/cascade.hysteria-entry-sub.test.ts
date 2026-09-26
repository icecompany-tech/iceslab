import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getHysteriaEntryLabels, getRouteProfilesByEntryNode } from './cascade.service.js';

/**
 * E48, stand 26.09: ru-01 -> ru-02 -> nl-01 switched to entryProtocol
 * hysteria. The node side hands users over from hysteria and gives xray no
 * drawing (userCoreFor), and the subscription still built the cascade's vless
 * profiles on ru-01 while its hy2 host went out as a plain ru-01 server. So the
 * client offered a way in the cascade does not carry, and the way it does
 * carry under the wrong name.
 *
 * The two answers the subscription reads, checked both ways around one
 * switch of entryProtocol.
 */
let ru01: string;
let ru02: string;
let nl01: string;
let se01: string;

async function node(name: string, cc: string): Promise<string> {
  return (
    await prisma.node.create({
      data: { name, address: `${name}.example.com:1337`, protocol: 'xray', countryCode: cc, heartbeatSecret: randomBytes(32) },
      select: { id: true },
    })
  ).id;
}

async function cascade(entryProtocol: string, directions: { tag: number; cc: string; nodeIds: string[] }[]) {
  const c = await prisma.cascade.create({ data: { name: 'ru', enabled: true, mode: 'chain' }, select: { id: true } });
  await prisma.cascadePosition.create({
    data: { cascadeId: c.id, position: 0, entryProtocol, nodes: { create: [{ nodeId: ru01 }] } },
  });
  await prisma.cascadePosition.create({
    data: { cascadeId: c.id, position: 1, nodes: { create: [{ nodeId: ru02 }] } },
  });
  for (const d of directions) {
    await prisma.cascadeDirection.create({
      data: { cascadeId: c.id, tag: d.tag, countryCode: d.cc, nodes: { create: d.nodeIds.map((nodeId) => ({ nodeId })) } },
    });
  }
  return c.id;
}

const switchEntry = (id: string, entryProtocol: string) =>
  prisma.cascadePosition.updateMany({ where: { cascadeId: id, position: 0 }, data: { entryProtocol } });

beforeEach(async () => {
  await cleanDatabase();
  ru01 = await node('ru-01', 'RU');
  ru02 = await node('ru-02', 'RU');
  nl01 = await node('nl-01', 'NL');
  se01 = await node('se-01', 'SE');
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('a cascade entered through hysteria in the subscription (E48)', () => {
  it('has no vless profiles on the entry and names its hy2 host after the cascade, and back', async () => {
    const id = await cascade('hysteria', [{ tag: 1, cc: 'NL', nodeIds: [nl01] }]);

    expect((await getRouteProfilesByEntryNode([ru01])).get(ru01) ?? []).toEqual([]);
    expect((await getHysteriaEntryLabels([ru01])).get(ru01)).toBe('🇳🇱 ru → NL');

    // Switched to xray: the profiles come back, the hy2 host goes back to its
    // own name (no label).
    await switchEntry(id, 'xray');
    const profiles = (await getRouteProfilesByEntryNode([ru01])).get(ru01) ?? [];
    expect(profiles.map((p) => p.label)).toContain('🇳🇱 ru → NL');
    expect((await getHysteriaEntryLabels([ru01])).has(ru01)).toBe(false);

    // And to hysteria again.
    await switchEntry(id, 'hysteria');
    expect((await getRouteProfilesByEntryNode([ru01])).get(ru01) ?? []).toEqual([]);
    expect((await getHysteriaEntryLabels([ru01])).get(ru01)).toBe('🇳🇱 ru → NL');
  });

  it('names the host with the Auto line when the chain chooses among several exits', async () => {
    await cascade('hysteria', [
      { tag: 1, cc: 'NL', nodeIds: [nl01] },
      { tag: 2, cc: 'SE', nodeIds: [se01] },
    ]);
    expect((await getHysteriaEntryLabels([ru01])).get(ru01)).toBe('⚡ ru → Auto');
  });

  it('labels only the entry, and not a node that is no way into the cascade', async () => {
    await cascade('hysteria', [{ tag: 1, cc: 'NL', nodeIds: [nl01] }]);
    const labels = await getHysteriaEntryLabels([ru01, ru02, nl01]);
    expect([...labels.keys()]).toEqual([ru01]);
  });
});
