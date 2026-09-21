import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { createCascade, CascadeEntryCoreTooOldError } from './cascade.service.js';

/**
 * The gate that decides whether a balancer entry may serve vlessRoute.
 *
 * It used to read `Node.coreVersion`, which is ONE field on a node that runs
 * several engines. The poller fills that field from the first core whose NAME
 * is 'xray', and the agent registers the sing-box adapter under that same
 * protocol name (main.go:306). So on a node running both, the field can hold
 * the sing-box version while the real xray is current, and the gate then
 * refuses a cascade that works perfectly.
 *
 * The inventory answers the question the field cannot, because a core there
 * carries its engine beside its name.
 */
let entryId: string;
let exitId: string;

type Core = { name: string; engine?: string; version?: string };

async function makeNode(name: string, cores: Core[] | null, coreVersion: string | null) {
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}.example.com:1337`,
      protocol: 'xray',
      countryCode: name.startsWith('nl') ? 'NL' : 'RU',
      heartbeatSecret: randomBytes(32),
      coreVersion,
      cores: cores
        ? ({ observedAt: new Date().toISOString(), cores } as unknown as object)
        : undefined,
    },
    select: { id: true },
  });
  return n.id;
}

/**
 * The smallest shape that actually REACHES the gate: one entry and TWO
 * directions, which folds to `balancer`.
 *
 * One direction folds to a plain chain instead, and the gate is skipped there
 * on purpose (a chain hands out no vlessRoute tags). The first version of this
 * file used one direction, and every case passed without the gate being called
 * at all, which is the failure mode a test is supposed to catch rather than
 * demonstrate.
 */
async function create(entry: string, exits: string[]) {
  return createCascade({
    name: `ru-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
    directions: exits.map((nodeId, i) => ({
      tag: i + 1,
      countryCode: i === 0 ? 'NL' : 'SE',
      nodeIds: [nodeId],
    })),
  } as never);
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('the balancer entry core gate', () => {
  it('reads the xray core, not the node field that can hold another engine', async () => {
    // The shape that was being refused: a node with both engines, where the
    // poller's single field landed on sing-box. Real xray is 26.3.27, well
    // past the 25.9.5 the tag needs.
    entryId = await makeNode(
      'ru-entry',
      [
        { name: 'xray', engine: 'singbox', version: '1.13.14' },
        { name: 'xray', engine: 'xray', version: '26.3.27' },
      ],
      '1.13.14',
    );
    exitId = await makeNode('nl-exit', null, null);
    const seA = await makeNode('se-exit', null, null);

    // Before the change this threw: the gate read 1.13.14 and called the node
    // too old, blocking a cascade whose xray was two years newer than needed.
    await expect(create(entryId, [exitId, seA])).resolves.toBeTruthy();
  });

  it('still refuses an xray that really is too old', async () => {
    // The gate has to keep working, or reading the right field buys nothing.
    entryId = await makeNode(
      'ru-old',
      [{ name: 'xray', engine: 'xray', version: '25.8.0' }],
      // The field says something modern, and it is ignored: the inventory is
      // what the cascade will actually run on.
      '26.3.27',
    );
    exitId = await makeNode('nl-exit-2', null, null);
    const seB = await makeNode('se-exit-2', null, null);

    await expect(create(entryId, [exitId, seB])).rejects.toBeInstanceOf(CascadeEntryCoreTooOldError);
    await expect(create(entryId, [exitId, seB])).rejects.toThrow('25.8.0');
  });

  it('allows a node that never reported its cores, because that is not a refusal', async () => {
    // Unknown is not old. An agent older than the inventory field, or a node
    // that has not been polled yet, must not wedge the operator: we cannot
    // prove it is too old, and an unprovable refusal is the worse error.
    entryId = await makeNode('ru-silent', null, '1.13.14');
    exitId = await makeNode('nl-exit-3', null, null);
    const seC = await makeNode('se-exit-3', null, null);

    await expect(create(entryId, [exitId, seC])).resolves.toBeTruthy();
  });

  it('allows an inventory that names no xray core, and one that reports no version', async () => {
    // Both are the same answer: we do not know. Neither is evidence of age.
    const noXray = await makeNode('ru-hy2', [{ name: 'hysteria', engine: 'hysteria', version: '2.6.2' }], null);
    const noVersion = await makeNode('ru-nover', [{ name: 'xray', engine: 'xray' }], null);
    const exitA = await makeNode('nl-exit-4', null, null);
    const exitB = await makeNode('nl-exit-5', null, null);

    const seD = await makeNode('se-exit-4', null, null);
    const seE = await makeNode('se-exit-5', null, null);
    await expect(create(noXray, [exitA, seD])).resolves.toBeTruthy();
    await expect(create(noVersion, [exitB, seE])).resolves.toBeTruthy();
  });

  it('reads an old agent by name, since it has no engine to read', async () => {
    // Before the engine field existed a core said only its protocol. There the
    // name is all there is, and using it is the honest reading: such an agent
    // predates the sing-box-under-xray registration being visible at all.
    entryId = await makeNode('ru-legacy', [{ name: 'xray', version: '25.8.0' }], null);
    exitId = await makeNode('nl-exit-6', null, null);
    const seF = await makeNode('se-exit-6', null, null);

    await expect(create(entryId, [exitId, seF])).rejects.toBeInstanceOf(CascadeEntryCoreTooOldError);
  });
});
