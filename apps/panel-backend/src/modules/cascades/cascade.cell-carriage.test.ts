import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { createCascade, updateCascade, CascadeCellNotCarriedError, hopBrokenReason } from './cascade.service.js';
import { canRunChainAtSave, carriesCellAtSave } from './cell-carriage.js';

/**
 * Whether the node a leg lands on can end that leg, phase 5.
 *
 * A direction may now choose the cell of the leg that reaches it, and two of
 * the four cells exist only inside the chain process, which is sing-box. So the
 * same dropdown that used to be harmless can now point a QUIC leg at a machine
 * running xray and nothing else: the panel would report the cascade saved, the
 * node would refuse the config, and the only trace would be a line in a journal
 * hours later.
 *
 * ⚠ The gate refuses by FACT and nothing else, which is the rule this file is
 * really about. Twice before, a cascade gate was built on a computed value and
 * refused working pairs: `Node.protocol` read as a capability list (23 refusals
 * on 2026-09-11), then the engine list inferred from a core's NAME. Here the
 * trap has a new shape: the absence of a chain block looks like "this agent
 * cannot chain" and is nothing of the kind. Every node reports that absence
 * until the panel has sent it a chain, which is every node the first time an
 * operator builds a cascade.
 */
let seq = 0;

type Core = { name: string; engine?: string; version?: string };

async function makeNode(
  name: string,
  cores: Core[] | null,
  chain?: { running: boolean; version?: string; error?: string },
  chainEngine?: string,
) {
  seq += 1;
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}-${seq}.example.com:1337`,
      protocol: 'xray',
      countryCode: name.startsWith('nl') ? 'NL' : 'RU',
      heartbeatSecret: randomBytes(32),
      cores: cores
        ? ({ observedAt: new Date().toISOString(), ...(chainEngine ? { chainEngine } : {}), cores } as unknown as object)
        : undefined,
      chainStatus: chain ? ({ ...chain, reservedPorts: [] } as unknown as object) : undefined,
    },
    select: { id: true },
  });
  return n.id;
}

/** One entry and one direction, with the cell the direction is reached over. */
async function create(entry: string, exit: string, cell?: string) {
  seq += 1;
  return createCascade({
    name: `ru-out-${seq}`,
    enabled: true,
    positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
    directions: [{ countryCode: 'NL', nodeIds: [exit], ...(cell ? { linkProtocol: cell } : {}) }],
  } as never);
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('carriesCellAtSave', () => {
  it('says yes to every cell for a node whose chain process is running', () => {
    const node = { cores: null, chainStatus: { running: true, version: '1.13.14', reservedPorts: [] } };
    for (const cell of ['vless', 'shadowsocks', 'hy2', 'tuic'] as const) {
      expect(carriesCellAtSave(node, cell)).toEqual({ ok: true, by: 'chain', engines: [] });
    }
  });

  it('says yes to a chain that is DOWN, because that is not evidence', () => {
    // The binary is there (the agent answered about it) and the reason it is
    // down may be the very config this save replaces. Reading it as "no" would
    // refuse a cascade because the previous save of it was broken.
    const node = {
      cores: { observedAt: 'now', cores: [{ name: 'xray', engine: 'xray' }] },
      chainStatus: { running: false, error: 'start failed', reservedPorts: [] },
    };
    expect(carriesCellAtSave(node, 'hy2')).toEqual({ ok: true, by: 'unknown', engines: [] });
  });

  it('refuses a QUIC cell on a node that reported xray and nothing else', () => {
    const node = {
      cores: { observedAt: 'now', cores: [{ name: 'xray', engine: 'xray' }] },
      chainStatus: null,
    };
    expect(carriesCellAtSave(node, 'hy2')).toMatchObject({ ok: false, by: 'engines' });
    expect(carriesCellAtSave(node, 'tuic')).toMatchObject({ ok: false, by: 'engines' });
    // And keeps working for the two the transitional fleet has always carried.
    expect(carriesCellAtSave(node, 'vless')).toMatchObject({ ok: true, by: 'engines' });
    expect(carriesCellAtSave(node, 'shadowsocks')).toMatchObject({ ok: true, by: 'engines' });
  });

  it('says yes to sing-box among the cores even with no chain ever run there', () => {
    // The case the absence-of-chain reading would get wrong. A node with
    // sing-box installed can run the chain the moment it is sent one, and it is
    // sent one BY this save.
    const node = {
      cores: { observedAt: 'now', cores: [{ name: 'tuic', engine: 'singbox' }] },
      chainStatus: null,
    };
    expect(carriesCellAtSave(node, 'tuic')).toMatchObject({ ok: true, by: 'engines' });
  });

  it('says yes when the report cannot be trusted, rather than guessing', () => {
    // Two ways not to know, one answer. The second is the one that matters: an
    // agent older than the `engine` field names only protocols, and the agent
    // registers sing-box under the protocol name "xray", so such a list cannot
    // be read as engines at all.
    expect(carriesCellAtSave({ cores: null, chainStatus: null }, 'hy2')).toEqual({
      ok: true,
      by: 'unknown',
      engines: [],
    });
    expect(
      carriesCellAtSave(
        { cores: { observedAt: 'now', cores: [{ name: 'xray' }] }, chainStatus: null },
        'hy2',
      ),
    ).toEqual({ ok: true, by: 'unknown', engines: [] });
  });
});

/**
 * E46, stand 26.09: ru-01 -> ru-02 -> nl-01 on vless legs, sing-box on none of
 * the three, saved without a word. Every node logged "no singbox binary on this
 * node, so the chain cannot be drawn" and "xray cascade fragments ignored": an
 * agent with a chain manager carries legs through its chain alone, and says so
 * now (chainEngine). For such an agent xray is no receiver of any cell.
 */
describe('an agent that carries legs through its chain alone (E46)', () => {
  const xrayOnly = (chain: unknown = null) => ({
    cores: {
      observedAt: 'now',
      chainEngine: 'singbox',
      cores: [
        { name: 'xray', engine: 'xray' },
        { name: 'tuic', engine: 'singbox', installed: false },
      ],
    },
    chainStatus: chain,
  });

  it('refuses even vless on it without sing-box, where an older agent would pass', () => {
    expect(carriesCellAtSave(xrayOnly(), 'vless')).toMatchObject({ ok: false, by: 'engines', engines: ['xray'] });
    expect(carriesCellAtSave(xrayOnly(), 'shadowsocks')).toMatchObject({ ok: false, by: 'engines' });
    // The same report without chainEngine is the transitional fleet: yes.
    const old = { cores: { observedAt: 'now', cores: [{ name: 'xray', engine: 'xray' }] }, chainStatus: null };
    expect(carriesCellAtSave(old, 'vless')).toMatchObject({ ok: true, by: 'engines' });
  });

  it('reads the engines, not a chain that is down for want of the binary', () => {
    const down = { running: false, error: 'no singbox binary on this node, so the chain cannot be drawn', reservedPorts: [] };
    expect(carriesCellAtSave(xrayOnly(down), 'vless')).toMatchObject({ ok: false, by: 'engines' });
    expect(canRunChainAtSave(xrayOnly(down))).toMatchObject({ ok: false });
  });

  it('says yes once sing-box is on the node, and to a running chain', () => {
    const withSingbox = {
      cores: { observedAt: 'now', chainEngine: 'singbox', cores: [{ name: 'xray', engine: 'xray' }, { name: 'tuic', engine: 'singbox' }] },
      chainStatus: null,
    };
    expect(carriesCellAtSave(withSingbox, 'vless')).toMatchObject({ ok: true });
    expect(carriesCellAtSave(xrayOnly({ running: true, reservedPorts: [] }), 'vless')).toMatchObject({ ok: true, by: 'chain' });
  });

  it('refuses the save and names every node without sing-box, the entry included', async () => {
    const xray = [{ name: 'xray', engine: 'xray' }];
    const ru01 = await makeNode('ru-01', xray, undefined, 'singbox');
    const nl01 = await makeNode('nl-01', xray, undefined, 'singbox');
    const err = await create(ru01, nl01, 'vless').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CascadeCellNotCarriedError);
    const msg = (err as Error).message;
    for (const name of ['ru-01', 'nl-01']) {
      expect(msg).toContain(`node "${name}" has no sing-box, and its agent carries every leg through the chain process`);
    }
    expect(await prisma.cascade.count()).toBe(0);
  });
});

describe('a broken hop in the cascade status (E46)', () => {
  const savedAt = new Date('2026-09-26T10:00:00Z');

  it('names the chain the node reports down, in the agent words', () => {
    expect(
      hopBrokenReason(
        {
          chainStatus: { running: false, error: 'no singbox binary on this node, so the chain cannot be drawn' },
          lastInboundSyncAt: new Date('2026-09-26T10:01:00Z'),
          lastInboundSyncError: null,
        },
        savedAt,
      ),
    ).toBe('chain process not running: no singbox binary on this node, so the chain cannot be drawn');
  });

  it('names a push refused after the save and not followed by a success', () => {
    const err = { at: '2026-09-26T10:02:00Z', message: '500 Node x returned 500: 1/1 inbounds failed to apply: chain: ...' };
    expect(
      hopBrokenReason({ chainStatus: null, lastInboundSyncAt: new Date('2026-09-26T09:00:00Z'), lastInboundSyncError: err }, savedAt),
    ).toBe(err.message);
    // A success after the refusal clears it; a refusal from before the save is not this save's.
    expect(
      hopBrokenReason({ chainStatus: null, lastInboundSyncAt: new Date('2026-09-26T10:03:00Z'), lastInboundSyncError: err }, savedAt),
    ).toBeNull();
    expect(
      hopBrokenReason(
        { chainStatus: null, lastInboundSyncAt: null, lastInboundSyncError: { at: '2026-09-26T09:59:00Z', message: 'old' } },
        savedAt,
      ),
    ).toBeNull();
  });

  it('is nothing on a running chain and a clean push', () => {
    expect(
      hopBrokenReason({ chainStatus: { running: true }, lastInboundSyncAt: new Date('2026-09-26T10:01:00Z'), lastInboundSyncError: null }, savedAt),
    ).toBeNull();
  });
});

describe('the cell-carriage gate on save', () => {
  it('refuses a tuic direction landing on an xray-only node, and names what it judged by', async () => {
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const exit = await makeNode('nl-exit', [{ name: 'xray', engine: 'xray' }]);

    await expect(create(entry, exit, 'tuic')).rejects.toBeInstanceOf(CascadeCellNotCarriedError);
    await expect(create(entry, exit, 'tuic')).rejects.toThrow('nl-exit');
    await expect(create(entry, exit, 'tuic')).rejects.toThrow('tuic');
    // The engines are in the message because they are the fact the refusal
    // rests on: without them the operator can only obey the rule.
    await expect(create(entry, exit, 'tuic')).rejects.toThrow('xray');
    expect(await prisma.cascade.count()).toBe(0);
  });

  it('lets the same pair through over vless and shadowsocks', async () => {
    // The transitional fleet, and the reason the gate cannot simply demand a
    // chain: these two legs land inside the node's own xray and have since C3.
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const nl = await makeNode('nl-exit', [{ name: 'xray', engine: 'xray' }]);
    const se = await makeNode('se-exit', [{ name: 'xray', engine: 'xray' }]);

    await expect(create(entry, nl, 'vless')).resolves.toBeTruthy();
    await expect(create(entry, se, 'shadowsocks')).resolves.toBeTruthy();
  });

  it('lets a QUIC cell through onto a node that runs the chain', async () => {
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const exit = await makeNode('nl-exit', null, { running: true, version: '1.13.14' });

    await expect(create(entry, exit, 'hy2')).resolves.toBeTruthy();
  });

  it('lets a QUIC cell through onto a node that has said nothing at all', async () => {
    // The whole fleet today. Unknown is not a refusal: the leg fails on the
    // node and the failure surfaces where every push failure does, in
    // lastInboundSyncError. An unprovable refusal wedges an operator instead.
    const entry = await makeNode('ru-entry', null);
    const exit = await makeNode('nl-exit', null);

    await expect(create(entry, exit, 'hy2')).resolves.toBeTruthy();
  });

  it('names every blocked node, not the first', async () => {
    // A cascade is saved whole. One refusal per leg would walk the operator
    // through as many saves as it has exits, each looking like a new problem.
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const nl = await makeNode('nl-exit', [{ name: 'xray', engine: 'xray' }]);
    const se = await makeNode('se-exit', [{ name: 'xray', engine: 'xray' }]);

    seq += 1;
    const save = createCascade({
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [
        { countryCode: 'NL', nodeIds: [nl], linkProtocol: 'hy2' },
        { countryCode: 'SE', nodeIds: [se], linkProtocol: 'tuic' },
      ],
    } as never);

    await expect(save).rejects.toBeInstanceOf(CascadeCellNotCarriedError);
    const err = await save.catch((e: CascadeCellNotCarriedError) => e);
    expect(err.conflicts).toHaveLength(2);
    expect(err.conflicts.map((c) => c.nodeName).sort()).toEqual(['nl-exit', 'se-exit']);
    expect(err.conflicts.map((c) => c.cell).sort()).toEqual(['hy2', 'tuic']);
  });

  it('asks again on an edit, because an edit re-picks the cells', async () => {
    // The realistic way into this: a direction served over vless since C3, one
    // dropdown, and a node nobody has touched since.
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const exit = await makeNode('nl-exit', [{ name: 'xray', engine: 'xray' }]);
    const created = await create(entry, exit, 'vless');

    await expect(
      updateCascade(created.id, {
        positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
        directions: [{ id: created.directions[0]!.id, nodeIds: [exit], linkProtocol: 'hy2' }],
      } as never),
    ).rejects.toBeInstanceOf(CascadeCellNotCarriedError);

    // And the stored cascade is untouched: a refused edit must not leave the
    // direction half-moved to a cell its node cannot end.
    const still = await prisma.cascadeDirection.findFirst({ select: { linkProtocol: true } });
    expect(still!.linkProtocol).toBe('vless');
  });

  it('says nothing about a leg between POSITIONS whose cell the node carries', async () => {
    // The walk covers every receiving side, not only the directions: a transit
    // receives the entry's cell. Here that cell is vless, so an xray-only
    // transit is fine, and the gate must not invent a refusal for it.
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const transit = await makeNode('de-transit', [{ name: 'xray', engine: 'xray' }]);
    const exit = await makeNode('nl-exit', [{ name: 'xray', engine: 'xray' }]);

    seq += 1;
    await expect(
      createCascade({
        name: `ru-out-${seq}`,
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
          { position: 1, nodeIds: [transit], linkProtocol: 'shadowsocks' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [exit] }],
      } as never),
    ).resolves.toBeTruthy();
  });

  it('refuses a QUIC cell chosen for the leg INTO a transit', async () => {
    // The other half of the same walk. The entry's cell is what the transit
    // receives, so choosing hy2 there points a QUIC leg at the transit, not at
    // the exit, and the refusal has to name the transit.
    const entry = await makeNode('ru-entry', [{ name: 'xray', engine: 'xray' }]);
    const transit = await makeNode('de-transit', [{ name: 'xray', engine: 'xray' }]);
    const exit = await makeNode('nl-exit', null, { running: true, version: '1.13.14' });

    seq += 1;
    const save = createCascade({
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'hy2' },
        { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
      ],
      directions: [{ countryCode: 'NL', nodeIds: [exit] }],
    } as never);

    const err = await save.catch((e: CascadeCellNotCarriedError) => e);
    expect(err).toBeInstanceOf(CascadeCellNotCarriedError);
    expect(err.conflicts.map((c) => c.nodeName)).toEqual(['de-transit']);
  });
});
