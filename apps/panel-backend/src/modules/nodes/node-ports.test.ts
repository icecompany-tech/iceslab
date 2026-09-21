import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NodeCores } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * "Is this port free on this node" has three sources and only two of them are
 * ours.
 *
 * Bindings and cascade legs the panel wrote itself. The ports a core opens for
 * ITSELF (the hysteria auth callback, the loopback gRPC sockets xray and
 * sing-box use for counters) are known only to the node, and a node that has
 * never reported, or one whose agent predates the field, leaves that source
 * silent.
 *
 * So the answer carries how completely it looked. A partial answer is enough to
 * refuse a port it names and never enough to promise one it does not: the rule
 * the engine gate is built on, learned there over two incidents.
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

const auth = () => ({ authorization: `Bearer ${token}` });

async function makeNode(name = 'eu-1') {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `pc-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** What the poller stores after a healthcheck, written straight in: the point
 *  here is the panel's reading of it, not the polling. */
async function reportCores(nodeId: string, cores: NodeCores['cores']): Promise<void> {
  await prisma.node.update({
    where: { id: nodeId },
    data: { cores: { observedAt: new Date().toISOString(), cores } as never },
  });
}

async function check(
  nodeId: string,
  port: number,
  transport: 'tcp' | 'udp' = 'tcp',
  exceptBindingId?: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/nodes/${nodeId}/port-check`,
    headers: auth(),
    payload: { port, transport, ...(exceptBindingId ? { exceptBindingId } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body);
}

async function bindProfile(nodeId: string, name: string, port: number) {
  const p = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: {
      name,
      protocol: 'xray',
      config: {
        security: 'reality',
        realityDest: 'www.microsoft.com:443',
        realityServerNames: ['www.microsoft.com'],
        realityPrivateKey: 'k'.repeat(43),
        realityPublicKey: 'p'.repeat(43),
        realityShortIds: ['0123abcd'],
        network: 'raw',
      },
    },
  });
  expect(p.statusCode, p.body).toBe(201);
  const b = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId: JSON.parse(p.body).id, nodeId, port },
  });
  expect(b.statusCode, b.body).toBe(201);
  return JSON.parse(b.body).id as string;
}

describe('the port check', () => {
  it('will not promise a port on a node that has never reported', async () => {
    const nodeId = await makeNode();

    const answer = await check(nodeId, 9999);

    // Nothing known against it, which is not the same as free, and the answer
    // says which of the two it is.
    expect(answer.ok).toBe(true);
    expect(answer.certainty).toBe('partial');
    expect(answer.note).toBe('reserved-ports-unknown');
    expect(answer.conflicts).toEqual([]);
  });

  it('is certain only when every reported core answered about its ports', async () => {
    const nodeId = await makeNode();
    await reportCores(nodeId, [
      {
        name: 'hysteria',
        engine: 'hysteria',
        reservedPorts: [
          { owner: 'hysteria-auth', port: 8080, transport: 'tcp' },
          { owner: 'hysteria-stats', port: 9999, transport: 'tcp' },
        ],
      },
      { name: 'xray', engine: 'xray', reservedPorts: [{ owner: 'xray-api', port: 8081, transport: 'tcp' }] },
    ]);

    expect((await check(nodeId, 443)).certainty).toBe('full');
    expect((await check(nodeId, 443)).note).toBeNull();
  });

  it('counts a core that holds NOTHING as having answered', async () => {
    // `[]` and a missing key are different answers on the wire: an adapter that
    // reserves nothing says so, one that cannot speak sends no key. Reading
    // both as silence would leave a node running only such cores permanently
    // unanswerable, which is a "we do not know" about a machine fully known.
    const nodeId = await makeNode();
    await reportCores(nodeId, [
      { name: 'naive', engine: 'naive', reservedPorts: [] },
      { name: 'amneziawg', engine: 'amneziawg', reservedPorts: [] },
    ]);

    const answer = await check(nodeId, 443);
    expect(answer.certainty).toBe('full');
    expect(answer.note).toBeNull();
    expect(answer.ok).toBe(true);
  });

  it('falls back to partial the moment one core stays silent', async () => {
    // One quiet core is enough: it is exactly the one that might be holding the
    // port being asked about.
    const nodeId = await makeNode();
    await reportCores(nodeId, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-auth', port: 8080, transport: 'tcp' }] },
      { name: 'xray' },
    ]);

    expect((await check(nodeId, 443)).certainty).toBe('partial');
  });

  it('names a core service by KEY, with no profile name to look for', async () => {
    const nodeId = await makeNode();
    await reportCores(nodeId, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-auth', port: 8080, transport: 'tcp' }] },
    ]);

    const answer = await check(nodeId, 8080);
    expect(answer.ok).toBe(false);
    expect(answer.conflicts).toEqual([
      { kind: 'core-service', ownerKey: 'hysteria-auth', port: 8080, transport: 'tcp' },
    ]);
    // No `name`: a core service is not something an operator named, and the
    // screen writes the words from the key.
    expect(answer.conflicts[0].name).toBeUndefined();
  });

  it('answers about the socket asked for, not the number', async () => {
    const nodeId = await makeNode();
    await reportCores(nodeId, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-auth', port: 8080, transport: 'tcp' }] },
    ]);

    expect((await check(nodeId, 8080, 'tcp')).ok).toBe(false);
    // The same number on UDP is a different socket and genuinely free.
    expect((await check(nodeId, 8080, 'udp')).ok).toBe(true);
  });

  it('names a profile by the name the operator gave it', async () => {
    const nodeId = await makeNode();
    await bindProfile(nodeId, 'reality-main', 443);

    const answer = await check(nodeId, 443);
    expect(answer.ok).toBe(false);
    expect(answer.conflicts).toEqual([
      { kind: 'profile', name: 'reality-main', port: 443, transport: 'tcp' },
    ]);
  });

  it('does not report the binding being edited as colliding with itself', async () => {
    const nodeId = await makeNode();
    const bindingId = await bindProfile(nodeId, 'reality-main', 443);

    expect((await check(nodeId, 443)).ok).toBe(false);
    expect((await check(nodeId, 443, 'tcp', bindingId)).ok).toBe(true);
  });

  it('names who holds the same number on the other transport', async () => {
    // The port IS free, and saying only "free" wastes what the panel knows.
    // 443/UDP beside a REALITY on 443/TCP is the pair the panel used to refuse
    // outright, so an operator looking at that number deserves to be told, by
    // name, that the two do not collide.
    const nodeId = await makeNode();
    await bindProfile(nodeId, 'reality-main', 443);

    const answer = await check(nodeId, 443, 'udp');
    expect(answer.ok).toBe(true);
    expect(answer.conflicts).toEqual([]);
    expect(answer.otherTransport).toEqual({
      holder: { kind: 'profile', name: 'reality-main', port: 443, transport: 'tcp' },
    });
  });

  it('leaves otherTransport null when the number is free on both', async () => {
    const nodeId = await makeNode();
    const answer = await check(nodeId, 2053, 'tcp');
    expect(answer.otherTransport).toBeNull();
  });

  it('404s for a node that does not exist', async () => {
    // "No conflicts on a node that is not there" is true and useless.
    const res = await app.inject({
      method: 'POST',
      url: `/api/nodes/11111111-1111-4111-8111-111111111111/port-check`,
      headers: auth(),
      payload: { port: 443, transport: 'tcp' },
    });
    expect(res.statusCode).toBe(404);
  });
});
