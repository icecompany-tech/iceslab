import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { applyInboundsForNode } from './inbounds.queue.js';

/**
 * A refused config has to leave a trace where the operator looks.
 *
 * The core answers one bad field by refusing the WHOLE config, so a node that
 * was serving fine goes dark on its next restart. The panel used to write a
 * single log line and rethrow: `lastInboundSyncAt` stopped moving, the screen
 * said "not applied yet" (which is also what a push still in flight looks
 * like) and the reason existed only in the agent's journal, behind ssh.
 *
 * Two halves, and the second is the one that rots if nobody pins it: an error
 * that is never cleared is worse than none, because it turns into a permanent
 * red mark on a node that has been healthy for a week.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function createNode(name: string, address: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/**
 * What the agent actually answers, not a placeholder.
 *
 * The shape matters to this test: the panel stores `${status} ${message}`, and
 * the agent's message carries the offending inbound BEFORE the core's own
 * words. Both halves are asserted below, because cutting the message at "core
 * rejected the config" was the tidier option and would have thrown away which
 * of the node's inbounds was refused.
 */
const CORE_REFUSAL =
  '1/1 inbounds failed to apply: reality-eu (xray): apply inbound 443: ' +
  'core rejected the config: exit status 23 ' +
  '(Failed to start: app/proxyman/inbound: failed to load config > ' +
  "infra/conf: unknown field 'realityNoSuchField')";

function failApply(): void {
  vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockRejectedValue(
    new NodeRequestError(`Node 10.0.0.1:8443 returned 500: ${CORE_REFUSAL}`, 500, {
      error: 'ADAPTER_FAILED',
      message: CORE_REFUSAL,
    }),
  );
}

function succeedApply(): void {
  vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockResolvedValue({
    ok: true,
    applied: 0,
    skipped: 0,
  });
}

const syncStateOf = (nodeId: string) =>
  prisma.node.findUniqueOrThrow({
    where: { id: nodeId },
    select: { lastInboundSyncAt: true, lastInboundSyncError: true },
  });

describe('a push the core refuses', () => {
  it('leaves the core words on the node', async () => {
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');
    failApply();

    // Still throws: this is bookkeeping about the failure, not a swallowing
    // of it. The job has to fail, or BullMQ never retries the push.
    await expect(applyInboundsForNode(nodeId)).rejects.toThrow();

    const { lastInboundSyncAt, lastInboundSyncError } = await syncStateOf(nodeId);
    const recorded = lastInboundSyncError as { at: string; message: string } | null;

    expect(recorded).not.toBeNull();
    // The core's own sentence, which is the entire value of the refusal.
    expect(recorded!.message).toContain('core rejected the config');
    expect(recorded!.message).toContain("unknown field 'realityNoSuchField'");
    // And which inbound it was, which lives BEFORE that marker.
    expect(recorded!.message).toContain('reality-eu');
    expect(Number.isNaN(Date.parse(recorded!.at))).toBe(false);

    // The stamp is untouched: a failed push did not apply anything, and moving
    // it would tell the node card that this config landed.
    expect(lastInboundSyncAt).toBeNull();
  });

  it('is forgotten as soon as a push succeeds', async () => {
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');

    failApply();
    await expect(applyInboundsForNode(nodeId)).rejects.toThrow();
    expect((await syncStateOf(nodeId)).lastInboundSyncError).not.toBeNull();

    vi.restoreAllMocks();
    succeedApply();
    await applyInboundsForNode(nodeId);

    const after = await syncStateOf(nodeId);
    // Both halves together, or the node reads as current and broken at once.
    expect(after.lastInboundSyncError).toBeNull();
    expect(after.lastInboundSyncAt).not.toBeNull();
  });

  it('does not let a huge core dump grow the row without limit', async () => {
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');
    vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockRejectedValue(
      new NodeRequestError('x'.repeat(9000), 500, null),
    );

    await expect(applyInboundsForNode(nodeId)).rejects.toThrow();

    const recorded = (await syncStateOf(nodeId)).lastInboundSyncError as {
      message: string;
    };
    expect(recorded.message.length).toBe(2000);
  });
});
