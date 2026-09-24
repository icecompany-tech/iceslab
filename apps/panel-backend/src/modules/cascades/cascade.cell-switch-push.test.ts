import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { applyInboundsForNode, applyInboundsRequestForNode } from '../inbounds/inbounds.queue.js';

/**
 * E24: switching a leg to a QUIC cell must push BOTH ends.
 *
 * Stand, 2026-09-24, cascade 123: the leg went vless -> hy2. The exit's push
 * carried the new link-in; the entry's push died building the LEGACY xray
 * block, which has no drawing of an hy2 leg and threw. The chain block of the
 * entry was fine and went down with it, so the entry's chain kept dialling the
 * old vless leg into a port the exit had just stopped listening on, and every
 * user behind it got "connection refused". Same with tuic.
 *
 * The legacy block serves only an agent that cannot run the chain, and such an
 * agent cannot end a QUIC leg at all, so for these nodes it is not drawn.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

const auth = () => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  seq = 0;
  // The push asks the agent for its geo files first (phase 9.2). These agents
  // are stand-ins with no address behind them: answer as an agent older than
  // geo, which gets its push exactly as before.
  vi.spyOn(NodeTransport.prototype, 'listAssets').mockRejectedValue(new NodeRequestError('404', 404, null));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const XRAY_CONFIG = {
  security: 'reality',
  realityDest: 'www.apple.com:443',
  realityServerNames: ['www.apple.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

/**
 * A node with an xray inbound of its own, as on the stand. It matters: the
 * legacy block rides ON the xray inbound, so a node without one never had it,
 * and every assertion about its absence below would pass for nothing.
 */
async function makeNode(name: string): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `${name}-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const nodeId = JSON.parse(res.body).id as string;
  const p = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: `reality-${name}-${seq}`, protocol: 'xray', config: XRAY_CONFIG },
  });
  expect(p.statusCode, p.body).toBe(201);
  const b = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId: JSON.parse(p.body).id, nodeId, port: 443 },
  });
  expect(b.statusCode, b.body).toBe(201);
  return nodeId;
}

async function chainRunning(nodeId: string): Promise<void> {
  await prisma.node.update({
    where: { id: nodeId },
    data: { chainStatus: { running: true, version: '1.13.14', reservedPorts: [] } },
  });
}

function positions(entry: string, cell: string) {
  return [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: cell }];
}

async function createCascade(entry: string, exit: string, cell: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: positions(entry, cell),
      directions: [{ countryCode: 'SE', nodeIds: [exit] }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string; directions: { id: string }[] };
}

async function switchCell(c: { id: string; directions: { id: string }[] }, entry: string, exit: string, cell: string) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cascades/${c.id}`,
    headers: auth(),
    payload: {
      positions: positions(entry, cell),
      directions: [{ id: c.directions[0]!.id, countryCode: 'SE', nodeIds: [exit] }],
    },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const legOf = (req: { chain?: { config: unknown } }) =>
  JSON.stringify(req.chain?.config ?? null);

describe('a leg switched to a QUIC cell', () => {
  for (const cell of ['hy2', 'tuic'] as const) {
    it(`pushes both ends in one save, with a running chain (${cell})`, async () => {
      const entry = await makeNode('ru-01');
      const exit = await makeNode('se-01');
      const c = await createCascade(entry, exit, 'vless');
      await chainRunning(entry);
      await chainRunning(exit);

      await switchCell(c, entry, exit, cell);

      const sent: string[] = [];
      vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockImplementation(async function (this: unknown, req) {
        sent.push(legOf(req as never));
        return { ok: true, applied: 0, skipped: 0 };
      });
      const before = new Date();
      await applyInboundsForNode(entry);
      await applyInboundsForNode(exit);

      for (const id of [entry, exit]) {
        const row = await prisma.node.findUniqueOrThrow({
          where: { id },
          select: { chainSentAt: true, lastInboundSyncError: true },
        });
        expect(row.lastInboundSyncError, `push to ${id === entry ? 'entry' : 'exit'} failed`).toBeNull();
        expect(row.chainSentAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      }
      // And the two ends agree on the new cell: the entry dials it, the exit
      // listens on it. This is the pair the stand did not get.
      const quicType = cell === 'hy2' ? '"type":"hysteria2"' : '"type":"tuic"';
      expect(sent).toHaveLength(2);
      for (const s of sent) {
        expect(s).toContain(quicType);
        expect(s).not.toContain('"type":"vless"');
      }
    });
  }

  it('carries no legacy block at all, on either end', async () => {
    const entry = await makeNode('ru-01');
    const exit = await makeNode('se-01');
    await createCascade(entry, exit, 'hy2');
    for (const id of [entry, exit]) {
      const req = (await applyInboundsRequestForNode(id))!;
      expect(req.chain, 'the chain block is what carries the leg').toBeDefined();
      // Not an hy2 leg drawn as vless (what the exit used to get), not a throw
      // (what the entry used to get): nothing, because nobody could use it.
      expect(req.cascade).toBeUndefined();
    }
  });
});

describe('the legacy block where it still has a reader', () => {
  it('is still sent for a vless leg to a node that runs no chain', async () => {
    // The transitional fleet: an agent that cannot see `chain` applies this,
    // so dropping it here would drop the cascade on every node not yet updated.
    const entry = await makeNode('ru-01');
    const exit = await makeNode('se-01');
    await createCascade(entry, exit, 'vless');
    const req = (await applyInboundsRequestForNode(entry))!;
    expect(JSON.stringify(req.cascade ?? null)).toContain('"protocol":"vless"');
    expect(req.chain).toBeDefined();
  });

  it('is not sent to a node whose chain is running, whatever the cell', async () => {
    const entry = await makeNode('ru-01');
    const exit = await makeNode('se-01');
    await createCascade(entry, exit, 'vless');
    await chainRunning(entry);
    const req = (await applyInboundsRequestForNode(entry))!;
    expect(req.cascade).toBeUndefined();
    expect(req.chain).toBeDefined();
  });
});
