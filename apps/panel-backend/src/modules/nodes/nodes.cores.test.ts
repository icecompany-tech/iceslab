import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoreStatus, NodeCores } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { observedCores, coresWorthWriting } from './nodes.cron.js';

/**
 * Which of a node's cores actually carries out the operator's policy.
 *
 * The node-level policy and resolver are optional adapter interfaces, and today
 * exactly ONE core of nine implements them. The push is broadcast to every
 * adapter and the ones that cannot render it skip silently, which is the right
 * contract on the node. The lie was the panel's: it showed the policy attached
 * to a node whose cores ignore it, with nothing anywhere saying so.
 *
 * It is a property of the CORE, not of the node: a node running xray beside tuic
 * on sing-box applies the policy to its xray users and not to the others.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const AT = '2026-09-11T12:00:00.000Z';

function core(over: Partial<CoreStatus> & { name: CoreStatus['name'] }): CoreStatus {
  return { running: true, ...over };
}

describe('what the panel keeps from the healthcheck', () => {
  it('keeps the flag per core, as the node reported it', () => {
    const got = observedCores(
      [
        core({ name: 'xray', engine: 'xray', rendersPolicy: true, rendersDns: true }),
        core({ name: 'tuic', engine: 'singbox', rendersPolicy: false, rendersDns: false }),
      ],
      AT,
    );
    expect(got.cores).toEqual([
      { name: 'xray', engine: 'xray', rendersPolicy: true, rendersDns: true },
      { name: 'tuic', engine: 'singbox', rendersPolicy: false, rendersDns: false },
    ]);
    expect(got.observedAt).toBe(AT);
  });

  it('leaves an old agent silent instead of answering for it', () => {
    // Absent is not false. A false here would tell the operator their policy is
    // ignored on a core that may well be applying it.
    const got = observedCores([core({ name: 'xray' })], AT);
    expect(got.cores[0]).toEqual({ name: 'xray' });
    expect('rendersPolicy' in got.cores[0]!).toBe(false);
  });

  it('does not keep liveness, which belongs to the node status', () => {
    // Stored only when something changes, so a copy of `running` here would sit
    // stale next to a node the panel knows is down.
    const got = observedCores([core({ name: 'xray', running: false })], AT);
    expect('running' in got.cores[0]!).toBe(false);
  });
});

describe('when the inventory is written back', () => {
  const inventory = (over?: Partial<NodeCores>): NodeCores => ({
    observedAt: AT,
    cores: [{ name: 'xray', engine: 'xray', rendersPolicy: true }],
    ...over,
  });
  const at = (iso: string) => Date.parse(iso);

  it('writes the first one', () => {
    expect(coresWorthWriting(null, inventory(), at(AT))).toBe(true);
  });

  it('does not write a poll that found the same cores', () => {
    // Every node, every 30 seconds: a write per tick for a value that changes
    // about never is WAL churn on a fleet.
    expect(coresWorthWriting(inventory(), inventory({ observedAt: AT }), at(AT))).toBe(false);
  });

  it('writes when a core learns to render the policy', () => {
    const before = inventory({ cores: [{ name: 'xray', engine: 'xray', rendersPolicy: false }] });
    expect(coresWorthWriting(before, inventory(), at(AT))).toBe(true);
  });

  it('writes when a core appears or disappears', () => {
    const two = inventory({
      cores: [
        { name: 'xray', engine: 'xray', rendersPolicy: true },
        { name: 'tuic', engine: 'singbox', rendersPolicy: false },
      ],
    });
    expect(coresWorthWriting(inventory(), two, at(AT))).toBe(true);
  });

  it('refreshes the stamp on the heartbeat so it keeps meaning something', () => {
    expect(coresWorthWriting(inventory(), inventory(), at('2026-09-11T12:11:00.000Z'))).toBe(true);
  });

  it('treats a garbled stamp as stale rather than freezing on it', () => {
    const broken = inventory({ observedAt: 'not a date' });
    expect(coresWorthWriting(broken, inventory(), at(AT))).toBe(true);
  });
});

describe('the node DTO', () => {
  it('hands the inventory to whoever draws the node', async () => {
    seq += 1;
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `cores-${seq}`, address: `cores-${seq}.test`, protocol: 'xray' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;

    // Fresh node, nobody has polled it yet. Null, and that is NOT "no cores":
    // the screen must not tell an operator their policy is ignored here.
    expect(JSON.parse(created.body).cores).toBeNull();

    await prisma.node.update({
      where: { id },
      data: {
        cores: observedCores(
          [
            core({ name: 'xray', engine: 'xray', rendersPolicy: true, rendersDns: true }),
            core({ name: 'amneziawg', engine: 'amneziawg', rendersPolicy: false }),
          ],
          AT,
        ) as unknown as object,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/nodes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { cores: NodeCores };
    expect(body.cores.cores).toHaveLength(2);
    expect(body.cores.cores[0]!.rendersPolicy).toBe(true);
    expect(body.cores.cores[1]!.rendersPolicy).toBe(false);
    expect(body.cores.observedAt).toBe(AT);
  });
});
