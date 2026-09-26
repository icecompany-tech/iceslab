import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';
import { applyInboundsForNode } from './inbounds.queue.js';
import { createCascade } from '../cascades/cascade.service.js';

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
  olderThanGeo();
});

/**
 * The push asks the agent for its geo files first (phase 9.2). These agents
 * are stand-ins with no address behind them: they answer as an agent older
 * than geo, which gets its push exactly as before. Set again by the two
 * helpers below, since a test that restores its mocks takes this one too.
 */
function olderThanGeo(): void {
  vi.spyOn(NodeTransport.prototype, 'listAssets').mockRejectedValue(new NodeRequestError('404', 404, null));
}

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
  olderThanGeo();
  vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockRejectedValue(
    new NodeRequestError(`Node 10.0.0.1:8443 returned 500: ${CORE_REFUSAL}`, 500, {
      error: 'ADAPTER_FAILED',
      message: CORE_REFUSAL,
    }),
  );
}

function succeedApply(): void {
  olderThanGeo();
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

  it('records a push that could not even be BUILT', async () => {
    /**
     * The 2026-09-22 incident, in one test.
     *
     * A direction of the cascade pointed at a soft-deleted node, so building
     * the push threw before anything was sent. The throw missed the catch that
     * writes this field, BullMQ retired the job with removeOnFail, and the
     * panel showed two RU cascade entries that had simply never applied. The
     * only copy of the reason was a failedReason in a Redis key nobody reads.
     *
     * A refusal to build is a failure of the push in exactly the way a refusal
     * to deliver it is.
     */
    const nodeId = await createNode('ru-01', '10.0.0.1:8443');
    const gone = await createNode('exit-1', '10.0.0.2:8443');
    const other = await createNode('exit-2', '10.0.0.3:8443');

    // Built through the service, so the v4 links exist exactly as they do in
    // production: this failure comes from the link that names a node the
    // renderer can no longer find an address for.
    await createCascade({
      name: 'ru',
      enabled: true,
      positions: [
        { position: 0, nodeIds: [nodeId], entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
      directions: [
        { tag: 1, countryCode: 'NL', nodeIds: [gone] },
        { tag: 2, countryCode: 'SE', nodeIds: [other] },
      ],
    } as never);

    // And then the way out is deleted underneath it, which is what an operator
    // retiring a VPS does and what nothing stopped them doing.
    await prisma.node.update({ where: { id: gone }, data: { deletedAt: new Date() } });

    // Nothing is mocked: the failure is real and happens before any transport.
    await expect(applyInboundsForNode(nodeId)).rejects.toThrow();

    const recorded = (await syncStateOf(nodeId)).lastInboundSyncError as {
      message: string;
    } | null;
    expect(recorded, 'a push that could not be built must still say so on the node').not.toBeNull();
    expect(recorded!.message).toContain('Cascade topology is broken');
    expect(recorded!.message).toContain(gone);
  });

  it('holds the node to a chain the agent refused to start (E46)', async () => {
    /**
     * ru-01, 26.09: the chain block reached the agent, which answered
     * ADAPTER_FAILED ("no singbox binary on this node"). chainSentAt was
     * stamped on a success only, so the node status never counted the dead
     * chain it was sent. The block DID arrive: stamped on the agent's refusal
     * too, and not on a failure that never reached it.
     */
    const entry = await createNode('ru-01', '10.0.0.1:8443');
    const exit = await createNode('nl-01', '10.0.0.2:8443');
    await createCascade({
      name: 'ru-nl',
      enabled: true,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ tag: 1, countryCode: 'NL', nodeIds: [exit] }],
    } as never);
    const chainRefusal = 'chain: no singbox binary on this node, so the chain cannot be drawn';
    olderThanGeo();
    const spy = vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockRejectedValue(
      new NodeRequestError(`Node 10.0.0.1:8443 returned 500: 1/0 inbounds failed to apply: ${chainRefusal}`, 500, {
        error: 'ADAPTER_FAILED',
        message: `1/0 inbounds failed to apply: ${chainRefusal}`,
      }),
    );
    await expect(applyInboundsForNode(entry)).rejects.toThrow();
    const sent = spy.mock.calls[0]![0];
    expect(sent.chain, 'the fixture push carried no chain block').toBeDefined();
    const row = await prisma.node.findUniqueOrThrow({ where: { id: entry }, select: { chainSentAt: true, lastInboundSyncError: true } });
    expect(row.chainSentAt).not.toBeNull();
    expect((row.lastInboundSyncError as { message: string }).message).toContain('no singbox binary');

    // A failure that never reached the agent leaves the stamp alone.
    await prisma.node.update({ where: { id: entry }, data: { chainSentAt: null } });
    vi.restoreAllMocks();
    olderThanGeo();
    vi.spyOn(NodeTransport.prototype, 'applyInbounds').mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(applyInboundsForNode(entry)).rejects.toThrow();
    expect((await prisma.node.findUniqueOrThrow({ where: { id: entry }, select: { chainSentAt: true } })).chainSentAt).toBeNull();
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
