import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NodeCores } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { LINK_PORT_BASE } from '../cascades/cascade.config.js';

/**
 * A refused save says WHO holds the port, in the same three codes and the same
 * union the port check answers with.
 *
 * The words are the panel's: it keeps one dictionary for these, in the
 * operator's language and in the right case inside a sentence. A second
 * dictionary on this side would drift from it in a week, so the backend sends
 * codes and substitutions and keeps its English prose only as the fallback for
 * anything with no screen.
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

const XRAY_CONFIG = {
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

async function makeNode(name: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `code-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function makeProfile(name: string, protocol = 'xray', config: unknown = XRAY_CONFIG) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name, protocol, config },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function bind(profileId: string, nodeId: string, port: number, expected = 201) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

async function reportCores(nodeId: string, cores: NodeCores['cores']): Promise<void> {
  await prisma.node.update({
    where: { id: nodeId },
    data: { cores: { observedAt: new Date().toISOString(), cores } as never },
  });
}

async function makeCascade(entry: string, exits: string[]) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
      directions: exits.map((nodeId, i) => ({
        tag: i + 1,
        countryCode: i === 0 ? 'NL' : 'SE',
        nodeIds: [nodeId],
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe('the three ways a port is already taken', () => {
  it('PORT_TAKEN_PROFILE: another profile listens on that socket', async () => {
    const node = await makeNode('dublin-1');
    await bind(await makeProfile('reality-direct'), node, 443);

    const refused = await bind(await makeProfile('reality-cdn'), node, 443, 409);
    expect(refused.error).toBe('PORT_TAKEN_PROFILE');
    expect(refused.conflicts).toEqual([
      { kind: 'profile', name: 'reality-direct', port: 443, transport: 'tcp' },
    ]);
    // The English prose stays as the fallback for anything with no screen.
    expect(refused.message).toContain('demultiplexer');
  });

  it('PORT_TAKEN_CASCADE: a cascade leg terminates there', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const refused = await bind(await makeProfile('reality-nl'), nl, LINK_PORT_BASE, 409);
    expect(refused.error).toBe('PORT_TAKEN_CASCADE');
    expect(refused.conflicts).toEqual([
      { kind: 'cascade', name: expect.stringContaining('ru-out'), port: LINK_PORT_BASE, transport: 'tcp' },
    ]);
  });

  it('PORT_TAKEN_CORE_SERVICE: a core opened it for itself', async () => {
    // The bleakest of the three: nothing to move, the number is spoken for.
    // Nothing in the database could have refused this, because the node is the
    // only party that knows the port at all.
    const node = await makeNode('fra-1');
    await reportCores(node, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-stats', port: 9999, transport: 'tcp' }] },
    ]);

    const refused = await bind(await makeProfile('reality-9999'), node, 9999, 409);
    expect(refused.error).toBe('PORT_TAKEN_CORE_SERVICE');
    expect(refused.conflicts).toEqual([
      { kind: 'core-service', ownerKey: 'hysteria-stats', port: 9999, transport: 'tcp' },
    ]);
    // No profile name anywhere in it: there is none, and inventing one would
    // send the operator looking for a profile that does not exist.
    expect(refused.conflicts[0].name).toBeUndefined();
  });

  it('says nothing about the other socket', async () => {
    // The same checks must not refuse the pair they were built to allow.
    const node = await makeNode('fra-2');
    await reportCores(node, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-stats', port: 9999, transport: 'tcp' }] },
    ]);
    await bind(await makeProfile('hy2-9999', 'hysteria', {}), node, 9999);
  });

  it('never sends one of the three codes with an empty conflicts list', async () => {
    /**
     * The invariant behind the question FRONT asked: can a 409 arrive with a
     * code and nothing to name? It cannot. Each of the three is constructed
     * from the owner it found, so a code without a conflict would mean the
     * refusal did not know why it refused.
     *
     * Pinned here rather than left to the screen's defensive branch: that
     * branch can then stay what it is, a belt against a future bug, instead of
     * quietly becoming the way this normally looks.
     */
    const node = await makeNode('inv-1');
    await reportCores(node, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-auth', port: 8080, transport: 'tcp' }] },
    ]);
    const entry = await makeNode('inv-entry');
    const nl = await makeNode('inv-nl');
    const se = await makeNode('inv-se');
    await makeCascade(entry, [nl, se]);
    await bind(await makeProfile('inv-held'), node, 443);

    const bodies = [
      await bind(await makeProfile('inv-same'), node, 443, 409),
      await bind(await makeProfile('inv-cascade'), nl, LINK_PORT_BASE, 409),
      await bind(await makeProfile('inv-service'), node, 8080, 409),
    ];

    expect(bodies.map((b) => b.error)).toEqual([
      'PORT_TAKEN_PROFILE',
      'PORT_TAKEN_CASCADE',
      'PORT_TAKEN_CORE_SERVICE',
    ]);
    for (const body of bodies) {
      expect(Array.isArray(body.conflicts), body.error).toBe(true);
      expect(body.conflicts.length, body.error).toBeGreaterThan(0);
    }
  });

  it('answers the same way when the binding is created through a host', async () => {
    /**
     * The second live save surface, and the one that is easy to forget: POST
     * /api/hosts creates the binding under the host when it is given a profile
     * and a port, so it reaches the same socket by another door.
     *
     * (POST /api/inbounds is NOT a third: `inboundsRoutes` has been unmounted
     * since slice 27 and the module is kept only for its config schemas. The
     * service-level check is there anyway, so the door cannot reopen onto an
     * unasked question.)
     */
    const node = await makeNode('fra-3');
    await reportCores(node, [
      { name: 'hysteria', reservedPorts: [{ owner: 'hysteria-auth', port: 8080, transport: 'tcp' }] },
    ]);
    const profileId = await makeProfile('reality-8080');

    const res = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId, nodeId: node, port: 8080, remark: 'Default' },
    });
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('PORT_TAKEN_CORE_SERVICE');
    expect(body.conflicts).toEqual([
      { kind: 'core-service', ownerKey: 'hysteria-auth', port: 8080, transport: 'tcp' },
    ]);
  });
});
