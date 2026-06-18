import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getHiddenCascadeNodeIds, invalidateHiddenCascadeNodeCache } from './cascade.service.js';

// Cascade leak fix: a non-entry hop (transit/exit) of an enabled cascade must
// never be a directly-connectable subscription endpoint, else the client
// bypasses the chain straight to the exit (the field bug: Happ connecting to
// the DE exit). getHiddenCascadeNodeIds is the set generateSubscription filters
// the user's bindings against.

let seq = 0;
async function node(name: string): Promise<string> {
  seq += 1;
  const n = await prisma.node.create({
    // heartbeatSecret is required (Bytes, no default - normally minted by the
    // node service); any 32 bytes is fine, this test never reads it.
    data: {
      name: `${name}-${seq}`,
      address: `${name}-${seq}.test:1337`,
      heartbeatSecret: Buffer.alloc(32),
    },
  });
  return n.id;
}

// Build a cascade straight through prisma: only nodeId + position drive
// getHiddenCascadeNodeIds, so we skip the inter-hop link creds the service adds.
async function cascade(name: string, enabled: boolean, nodeIds: string[]): Promise<void> {
  await prisma.cascade.create({
    data: { name, enabled, hops: { create: nodeIds.map((nodeId, i) => ({ nodeId, position: i })) } },
  });
  invalidateHiddenCascadeNodeCache();
}

beforeEach(async () => {
  await cleanDatabase();
  invalidateHiddenCascadeNodeCache();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('getHiddenCascadeNodeIds (cascade subscription exposure)', () => {
  it('hides every NON-entry hop of an enabled cascade, keeps the entry', async () => {
    const ru = await node('ru');
    const de01 = await node('de01');
    const de02 = await node('de02');
    await cascade('ru-de01-de02', true, [ru, de01, de02]);

    const hidden = await getHiddenCascadeNodeIds();
    expect(hidden.has(ru)).toBe(false); // entry stays directly connectable
    expect(hidden.has(de01)).toBe(true); // transit hidden
    expect(hidden.has(de02)).toBe(true); // exit hidden (the field leak)
    expect(hidden.size).toBe(2);
  });

  it('hides nothing for a DISABLED cascade', async () => {
    const ru = await node('ru');
    const de = await node('de');
    await cascade('off', false, [ru, de]);
    expect((await getHiddenCascadeNodeIds()).size).toBe(0);
  });

  it('keeps a node exposed when it is an entry somewhere, even if a non-entry elsewhere', async () => {
    const a = await node('a');
    const b = await node('b');
    const c = await node('c');
    await cascade('cas1', true, [a, b]); // a entry, b exit
    await cascade('cas2', true, [b, c]); // b entry, c exit

    const hidden = await getHiddenCascadeNodeIds();
    expect(hidden.has(a)).toBe(false); // entry of cas1
    expect(hidden.has(b)).toBe(false); // exit of cas1 BUT entry of cas2 -> exposed
    expect(hidden.has(c)).toBe(true); // exit of cas2
    expect(hidden.size).toBe(1);
  });
});
