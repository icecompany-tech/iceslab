import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { getCascadeStatus } from './cascade.service.js';

// Saving a cascade pushes config to its hops asynchronously, so the UI polls
// this to tell a landed save from one still in flight. The signal MUST be the
// applyInbounds acknowledgement (`lastInboundSyncAt`), never `lastStatusChange`:
// that one only moves on an online/offline transition, so a node that simply
// stays healthy would never look "applied" and every successful save would read
// as stuck forever. These tests pin that down.

let seq = 0;

async function node(opts: { status?: string; lastStatusChange?: Date } = {}): Promise<string> {
  seq += 1;
  const n = await prisma.node.create({
    // heartbeatSecret is required (Bytes, no default); any 32 bytes will do.
    data: {
      name: `n-${seq}`,
      address: `n-${seq}.test:1337`,
      heartbeatSecret: Buffer.alloc(32),
      status: opts.status ?? 'online',
      lastStatusChange: opts.lastStatusChange ?? null,
    },
  });
  return n.id;
}

async function cascadeWith(nodeIds: string[]) {
  seq += 1;
  return prisma.cascade.create({
    data: {
      name: `c-${seq}`,
      enabled: true,
      hops: { create: nodeIds.map((nodeId, i) => ({ nodeId, position: i })) },
    },
  });
}

async function acknowledgedAt(nodeId: string, when: Date): Promise<void> {
  await prisma.node.update({ where: { id: nodeId }, data: { lastInboundSyncAt: when } });
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('getCascadeStatus', () => {
  it('holds a hop pending until it acknowledges a push made after the save', async () => {
    const a = await node();
    const c = await cascadeWith([a]);

    let st = await getCascadeStatus(c.id);
    expect(st.hops[0]!.applied).toBe(false); // never synced at all
    expect(st.done).toBe(false);

    // An acknowledgement from BEFORE the save is not evidence for this save.
    await acknowledgedAt(a, new Date(c.updatedAt.getTime() - 5000));
    st = await getCascadeStatus(c.id);
    expect(st.hops[0]!.applied).toBe(false);

    // One from after it is.
    await acknowledgedAt(a, new Date(c.updatedAt.getTime() + 5000));
    st = await getCascadeStatus(c.id);
    expect(st.hops[0]!.applied).toBe(true);
    expect(st.done).toBe(true);
  });

  it('is done only once EVERY hop acknowledged', async () => {
    const a = await node();
    const b = await node();
    const c = await cascadeWith([a, b]);
    await acknowledgedAt(a, new Date(c.updatedAt.getTime() + 5000));

    const st = await getCascadeStatus(c.id);
    expect(st.hops).toHaveLength(2);
    expect(st.done).toBe(false);
    expect(st.hops.filter((h) => !h.applied).map((h) => h.nodeId)).toEqual([b]);
  });

  it('keys on the sync acknowledgement, not on a status transition', async () => {
    // The regression this was rebuilt around: a node online for days carries an
    // ancient lastStatusChange but a fresh sync marker. It must read as applied,
    // otherwise a perfectly good save looks stuck to the operator.
    const a = await node({ status: 'online', lastStatusChange: new Date('2020-01-01T00:00:00Z') });
    const c = await cascadeWith([a]);
    await acknowledgedAt(a, new Date(c.updatedAt.getTime() + 1000));

    const st = await getCascadeStatus(c.id);
    expect(st.hops[0]!.applied).toBe(true);
    expect(st.done).toBe(true);
  });

  it('reports an unreachable hop as offline and not applied', async () => {
    const a = await node({ status: 'unreachable' });
    const c = await cascadeWith([a]);

    const st = await getCascadeStatus(c.id);
    expect(st.hops[0]!.online).toBe(false);
    expect(st.hops[0]!.applied).toBe(false);
    expect(st.done).toBe(false);
  });

  it('throws for an unknown cascade', async () => {
    await expect(getCascadeStatus('00000000-0000-0000-0000-0000000000ff')).rejects.toThrow();
  });
});
