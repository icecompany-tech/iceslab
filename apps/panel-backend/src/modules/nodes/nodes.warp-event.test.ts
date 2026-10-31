import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { disableNodeWarp, registerNodeWarp } from './nodes.service.js';

// The Cloudflare call is warp.service's own test; here it answers at once.
vi.mock('../warp/warp.service.js', async (orig) => ({
  ...(await orig<typeof import('../warp/warp.service.js')>()),
  registerWarpDevice: vi.fn(async () => ({ secretKey: 'k', publicKey: 'p', address: ['172.16.0.2/32'] })),
}));

/**
 * A-049: turning WARP on or off wrote the node and said nothing, so the node
 * kept its old egress until some unrelated edit pushed it. Both now emit
 * node.updated, the event the general edit uses to push.
 */
beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

async function node(warpEnabled: boolean): Promise<{ id: string; name: string }> {
  return prisma.node.create({
    data: { name: `warp-${warpEnabled}`, address: '203.0.113.9', protocol: 'xray', heartbeatSecret: randomBytes(32), warpEnabled },
    select: { id: true, name: true },
  });
}

describe('WARP on a node', () => {
  it('register emits node.updated for the node', async () => {
    const n = await node(false);
    const emit = vi.spyOn(eventBus, 'emit');
    await registerNodeWarp(n.id);
    expect(emit).toHaveBeenCalledWith('node.updated', { nodeId: n.id, nodeName: n.name });
  });

  it('disable emits node.updated for a node that had it on', async () => {
    const n = await node(true);
    const emit = vi.spyOn(eventBus, 'emit');
    await disableNodeWarp(n.id);
    expect(emit).toHaveBeenCalledWith('node.updated', { nodeId: n.id, nodeName: n.name });
  });

  it('disable on a node that had it off changes nothing and pushes nothing', async () => {
    const n = await node(false);
    const emit = vi.spyOn(eventBus, 'emit');
    await disableNodeWarp(n.id);
    expect(emit).not.toHaveBeenCalledWith('node.updated', expect.anything());
  });
});
