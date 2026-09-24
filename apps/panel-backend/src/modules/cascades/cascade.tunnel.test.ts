import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import {
  createCascade,
  updateCascade,
  rotateCascadeTunnels,
  CascadeTunnelNotFoundError,
  LinkUnderlayNotOnNodeError,
} from './cascade.service.js';
import {
  freeTunnelIndexes,
  newTunnelObfuscation,
  parseTunnelCred,
  topologyTunnelPairs,
  tunnelAddresses,
  tunnelIface,
  tunnelPort,
} from './cascade-tunnel.js';
import { portOwnersOnNode } from '../nodes/node-ports.js';
import { storedLinkParams } from './direction-merge.js';
import { mapCascade } from './cascade.mapper.js';

/**
 * Phase 8.1: a leg may ride an AmneziaWG tunnel (`linkParams.underlay: 'awg'`).
 * The contract and the panel's half: what is stored, what is minted, what is
 * refused. The agent raising the tunnel is Ф8.2.
 */
let seq = 0;

async function makeNode(name: string, cores?: { name: string; engine?: string; installed?: boolean }[]) {
  seq += 1;
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}-${seq}.example.com:1337`,
      protocol: 'xray',
      countryCode: 'NL',
      heartbeatSecret: randomBytes(32),
      cores: cores ? ({ observedAt: new Date().toISOString(), cores } as unknown as object) : undefined,
    },
    select: { id: true },
  });
  return n.id;
}

function cascadeInput(
  entry: string,
  exits: string[],
  underlay?: 'direct' | 'awg',
  onDirection = false,
) {
  seq += 1;
  const params = underlay ? { linkParams: { underlay } } : {};
  return {
    name: `awg-${seq}`,
    enabled: true,
    positions: [
      { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless', ...(onDirection ? {} : params) },
    ],
    directions: [{ countryCode: 'NL', nodeIds: exits, ...(onDirection ? params : {}) }],
  } as never;
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('the tunnel numbers', () => {
  it('derives the interface, the /30 and the port from one index, apart from every other range', () => {
    expect(tunnelIface(0)).toBe('awg-l0');
    expect(tunnelIface(999)).toBe('awg-l999');
    expect(tunnelAddresses(0)).toEqual({ network: '10.67.0.0/30', from: '10.67.0.1', to: '10.67.0.2' });
    expect(tunnelAddresses(65)).toEqual({ network: '10.67.1.4/30', from: '10.67.1.5', to: '10.67.1.6' });
    expect(tunnelPort(0)).toBe(27000);
    expect(tunnelPort(999)).toBe(27999);
    // Never the users' AWG subnet.
    for (const i of [0, 1, 63, 64, 500, 999]) expect(tunnelAddresses(i).from.startsWith('10.66.')).toBe(false);
    expect(() => tunnelAddresses(1000)).toThrow(RangeError);
  });

  it('reuses freed indexes, smallest first', () => {
    expect(freeTunnelIndexes(new Set([0, 1, 3]), 3)).toEqual([2, 4, 5]);
  });

  it('mints obfuscation the module takes, S3 and S4 set', () => {
    for (let i = 0; i < 200; i++) {
      const o = newTunnelObfuscation();
      expect(o.jmin).toBeGreaterThanOrEqual(64);
      expect(o.jmax).toBeGreaterThan(o.jmin);
      expect(o.jmax).toBeLessThanOrEqual(1024);
      expect(o.s1 + 56).not.toBe(o.s2);
      expect(o.s3).toBeGreaterThan(0);
      expect(o.s4).toBeGreaterThan(0);
      expect(o.s4).toBeLessThanOrEqual(32);
      expect(new Set([o.h1, o.h2, o.h3, o.h4]).size).toBe(4);
      expect(Math.min(o.h1, o.h2, o.h3, o.h4)).toBeGreaterThan(4);
    }
  });
});

describe('linkParams.underlay', () => {
  it('is read back only when it is a value this build knows', () => {
    expect(storedLinkParams({ underlay: 'awg', congestion: 'cubic' })).toEqual({ underlay: 'awg', congestion: 'cubic' });
    expect(storedLinkParams({ underlay: 'wireguard' })).toBeNull();
  });

  it('takes the pairs of the legs that chose it, the last leg falling back to the position', () => {
    const pairs = topologyTunnelPairs(
      [
        { position: 0, nodeIds: ['a'], linkParams: { underlay: 'awg' } },
        { position: 1, nodeIds: ['b'] },
      ],
      [{ nodeIds: ['c', 'd'] }, { nodeIds: ['e'], linkParams: { underlay: 'awg' } }],
    );
    expect(pairs).toEqual([
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'e' },
    ]);
  });
});

describe('the tunnels a save writes', () => {
  it('mints one tunnel per pair, a pool of two exits is two tunnels with two subnets', async () => {
    const entry = await makeNode('ru-entry');
    const nl1 = await makeNode('nl-1');
    const nl2 = await makeNode('nl-2');
    const c = await createCascade(cascadeInput(entry, [nl1, nl2], 'awg'));
    const tunnels = await prisma.cascadeTunnel.findMany({ where: { cascadeId: c.id }, orderBy: { index: 'asc' } });
    expect(tunnels.map((t) => [t.fromNodeId, t.toNodeId, t.index, t.port])).toEqual([
      [entry, nl1, 0, 27000],
      [entry, nl2, 1, 27001],
    ]);
    for (const t of tunnels) expect(parseTunnelCred(t.config)).not.toBeNull();
    // The position's linkParams are stored and read back with the knob.
    const pos = await prisma.cascadePosition.findFirstOrThrow({ where: { cascadeId: c.id } });
    expect(storedLinkParams(pos.linkParams)).toEqual({ underlay: 'awg' });
  });

  it('keeps a tunnel across an unrelated save, and takes it down when the leg goes direct', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    const c = await createCascade(cascadeInput(entry, [nl], 'awg'));
    const before = await prisma.cascadeTunnel.findFirstOrThrow({ where: { cascadeId: c.id } });

    // A save that rewrites the whole topology and changes nothing about the
    // leg: the country of the direction.
    const position = { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' };
    await updateCascade(c.id, {
      name: 'renamed',
      positions: [{ ...position, linkParams: { underlay: 'awg' } }],
      directions: [{ countryCode: 'DE', nodeIds: [nl] }],
    } as never);
    const after = await prisma.cascadeTunnel.findFirstOrThrow({ where: { cascadeId: c.id } });
    // Same row, same keys: an unrelated edit does not re-key a tunnel under
    // live traffic.
    expect(after.id).toBe(before.id);
    expect(after.config).toEqual(before.config);

    await updateCascade(c.id, {
      positions: [{ ...position, linkParams: { underlay: 'direct' } }],
      directions: [{ countryCode: 'DE', nodeIds: [nl] }],
    } as never);
    expect(await prisma.cascadeTunnel.count({ where: { cascadeId: c.id } })).toBe(0);
  });

  it('writes no tunnel for a cascade that says nothing about the underlay', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    await createCascade(cascadeInput(entry, [nl]));
    expect(await prisma.cascadeTunnel.count()).toBe(0);
  });

  it('reports the tunnel port as held, so a profile cannot take it', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    await createCascade(cascadeInput(entry, [nl], 'awg', true));
    const owners = await portOwnersOnNode(nl, [27000]);
    expect(owners).toEqual([expect.objectContaining({ kind: 'cascade', port: 27000, transport: 'udp' })]);
    // The dialling end holds no port for it.
    expect(await portOwnersOnNode(entry, [27000])).toEqual([]);
  });
});

describe('the tunnels on the cascade answer (8.3)', () => {
  it('lists each tunnel without its keys, and says the link port is closed when every leg rides one', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    const c = await createCascade(cascadeInput(entry, [nl], 'awg'));
    expect(c.tunnels).toEqual([
      {
        fromNodeId: entry,
        toNodeId: nl,
        iface: 'awg-l0',
        network: '10.67.0.0/30',
        fromAddress: '10.67.0.1',
        toAddress: '10.67.0.2',
        port: 27000,
        publicLinkPortOpen: false,
      },
    ]);
    expect(JSON.stringify(c)).not.toContain('privateKey');
  });

  it('says the link port stays open when another leg into the same node has no tunnel under it', () => {
    // The API cannot build this mix today (a node sits in one step, so every
    // leg into it shares one underlay); it arises when one tunnel of a pool is
    // missing. Built as a row, the way the mapper receives it.
    const now = new Date();
    const dto = mapCascade({
      id: 'c',
      name: 'mixed',
      enabled: true,
      mode: 'chain',
      hideHopsFromSub: true,
      createdAt: now,
      updatedAt: now,
      hops: [],
      positions: [
        { position: 0, entryProtocol: 'xray', linkProtocol: 'vless', linkParams: { underlay: 'awg' }, nodes: [{ nodeId: 'a1' }, { nodeId: 'a2' }] },
      ],
      directions: [{ id: 'd', tag: 1, countryCode: 'NL', nodes: [{ nodeId: 'x' }] }],
      tunnels: [{ fromNodeId: 'a1', toNodeId: 'x', index: 0, port: 27000 }],
      links: [
        { fromNodeId: 'a1', toNodeId: 'x', directionTag: 1 },
        { fromNodeId: 'a2', toNodeId: 'x', directionTag: 1 },
      ],
    });
    expect(dto.tunnels).toHaveLength(1);
    expect(dto.tunnels[0]!.publicLinkPortOpen).toBe(true);
  });

  it('is an empty list, always present, when nothing rides a tunnel', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    const c = await createCascade(cascadeInput(entry, [nl]));
    expect(c.tunnels).toEqual([]);
  });
});

describe('rotating the tunnels (8.3)', () => {
  it('re-keys on request only, keeping index, interface and port', async () => {
    const entry = await makeNode('ru-entry');
    const nl1 = await makeNode('nl-1');
    const nl2 = await makeNode('nl-2');
    const c = await createCascade(cascadeInput(entry, [nl1, nl2], 'awg'));
    const before = await prisma.cascadeTunnel.findMany({ where: { cascadeId: c.id }, orderBy: { index: 'asc' } });

    // One pair.
    await rotateCascadeTunnels(c.id, { fromNodeId: entry, toNodeId: nl1 });
    const one = await prisma.cascadeTunnel.findMany({ where: { cascadeId: c.id }, orderBy: { index: 'asc' } });
    expect(one.map((t) => [t.id, t.index, t.port])).toEqual(before.map((t) => [t.id, t.index, t.port]));
    expect(one[0]!.config).not.toEqual(before[0]!.config);
    expect(one[1]!.config).toEqual(before[1]!.config);

    // All of them.
    await rotateCascadeTunnels(c.id);
    const all = await prisma.cascadeTunnel.findMany({ where: { cascadeId: c.id }, orderBy: { index: 'asc' } });
    expect(all[1]!.config).not.toEqual(before[1]!.config);
    for (const t of all) expect(parseTunnelCred(t.config)).not.toBeNull();
  });

  it('says so when the pair has no tunnel', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-1');
    const c = await createCascade(cascadeInput(entry, [nl]));
    await expect(rotateCascadeTunnels(c.id, { fromNodeId: entry, toNodeId: nl })).rejects.toBeInstanceOf(
      CascadeTunnelNotFoundError,
    );
  });
});

describe('the underlay gate', () => {
  it('refuses an awg leg on a node that reports AmneziaWG as not installed, naming it', async () => {
    const entry = await makeNode('ru-entry', [
      { name: 'xray', engine: 'xray', installed: true },
      { name: 'amneziawg', engine: 'amneziawg', installed: true },
    ]);
    const nl = await makeNode('nl-bare', [
      { name: 'xray', engine: 'xray', installed: true },
      { name: 'amneziawg', engine: 'amneziawg', installed: false },
    ]);
    const attempt = createCascade(cascadeInput(entry, [nl], 'awg'));
    await expect(attempt).rejects.toBeInstanceOf(LinkUnderlayNotOnNodeError);
    await expect(createCascade(cascadeInput(entry, [nl], 'awg'))).rejects.toThrow('nl-bare');
    expect(await prisma.cascade.count()).toBe(0);
    // The same pair direct is none of this gate's business.
    await expect(createCascade(cascadeInput(entry, [nl], 'direct'))).resolves.toBeDefined();
  });

  it('lets through a node that never reported, or reported no amneziawg row', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-old', [{ name: 'xray', engine: 'xray' }]);
    await expect(createCascade(cascadeInput(entry, [nl], 'awg'))).resolves.toBeDefined();
  });
});
