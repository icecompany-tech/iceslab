import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getCascadeFragmentsForNode } from './cascade.service.js';
import { getLogger } from '../../lib/infra/logger.js';

/**
 * An enabled cascade that carries nothing says so.
 *
 * The builders return null when a hop's stored cred is missing or malformed,
 * which is the right call: half a chain blackholes user traffic. What was
 * missing is the word about it. The panel shows the cascade enabled, the
 * subscription keeps handing out its entry, and nothing anywhere says the
 * chain is empty.
 *
 * Found on live data, not imagined: the one cascade in the local database is
 * enabled, has two hops and NULL link_config on both.
 */
let seq = 0;

beforeEach(async () => {
  await cleanDatabase();
  seq = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

async function node(): Promise<string> {
  seq += 1;
  const n = await prisma.node.create({
    data: {
      name: `n-${seq}`,
      address: `n-${seq}.test:1337`,
      heartbeatSecret: Buffer.alloc(32),
      status: 'online',
    },
  });
  return n.id;
}

/** Written straight into the tables, the way the junk cascade in the local
 *  database was: two hops, enabled, and no link cred anywhere. */
async function cascadeWithoutCreds(nodeIds: string[], enabled = true) {
  seq += 1;
  return prisma.cascade.create({
    data: {
      name: `c-${seq}`,
      enabled,
      hops: { create: nodeIds.map((nodeId, i) => ({ nodeId, position: i })) },
    },
  });
}

function captureWarnings(): string[] {
  const lines: string[] = [];
  vi.spyOn(getLogger(), 'warn').mockImplementation((msg: unknown) => {
    lines.push(String(msg));
  });
  return lines;
}

describe('an enabled cascade with nothing to ship', () => {
  it('names the cascade and the node in the log', async () => {
    const entry = await node();
    const exit = await node();
    const c = await cascadeWithoutCreds([entry, exit]);
    const warnings = captureWarnings();

    expect(await getCascadeFragmentsForNode(entry)).toBeNull();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(c.name);
    expect(warnings[0]).toContain(entry);
  });

  it('stays quiet about a node that is in no cascade at all', async () => {
    // The ordinary case, and by far the commonest: every node that is not a
    // hop takes this path on every push. A line here would be noise per node
    // per sync, which is the fastest way to make a log unreadable.
    const lonely = await node();
    const warnings = captureWarnings();

    expect(await getCascadeFragmentsForNode(lonely)).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('stays quiet about a DISABLED cascade', async () => {
    // Disabled is a decision, not a fault: it ships nothing on purpose.
    const entry = await node();
    const exit = await node();
    await cascadeWithoutCreds([entry, exit], false);
    const warnings = captureWarnings();

    expect(await getCascadeFragmentsForNode(entry)).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('says nothing when the chain actually builds', async () => {
    // The guard against a line that fires on every healthy cascade: with creds
    // in place the fragments exist and there is nothing to report.
    const entry = await node();
    const exit = await node();
    const c = await cascadeWithoutCreds([entry, exit]);
    const hops = await prisma.cascadeHop.findMany({
      where: { cascadeId: c.id },
      orderBy: { position: 'asc' },
    });
    await prisma.cascadeHop.update({
      where: { id: hops[0]!.id },
      data: {
        linkProtocol: 'vless',
        linkConfig: { protocol: 'vless', port: 24000, uuid: '8f4a2b1c-0d3e-4f5a-9b6c-7d8e9f0a1b2c' },
      },
    });
    const warnings = captureWarnings();

    expect(await getCascadeFragmentsForNode(entry)).not.toBeNull();
    expect(warnings).toEqual([]);
  });
});
