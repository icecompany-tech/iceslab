import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { chainSecretFor, readChainSecret } from './chain-secret.js';

/**
 * The chain process's password, and where it is allowed to be seen.
 *
 * The tests below are mostly about ABSENCE, which is the hard thing to check: a
 * secret that leaks into a DTO leaks quietly, passes every test written about
 * what the DTO should contain, and is discovered by somebody reading a browser
 * network tab. So the shape assertions here are written the other way round,
 * over the serialised response rather than over the fields anybody remembered
 * to name.
 */
describe('the chain secret', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    await cleanDatabase();
    app = await buildApp();
    await app.ready();
    token = await registerAndLogin(app);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await closeRedis();
  });

  async function makeNode(name = 'ru-01'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { name, address: `${name}.example.com`, protocol: 'xray' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  it('is minted on first use and never again', async () => {
    const nodeId = await makeNode();
    // A node that has never rendered a chain carries none: the fleet predating
    // phase 4 is in exactly this state, and minting for machines that will
    // never present a credential is a credential to look after for nothing.
    expect(await readChainSecret(nodeId)).toBeNull();

    const first = await chainSecretFor(nodeId);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Same secret on every later render. A second value would mean the node's
    // core authenticating against listeners that expect the first one.
    expect(await chainSecretFor(nodeId)).toBe(first);
    expect(await readChainSecret(nodeId)).toBe(first);
  });

  it('gives two nodes two secrets', async () => {
    // One per NODE, because there is one chain process per machine. Sharing one
    // across the fleet would mean a shell on any node yields the loopback proxy
    // on every other.
    const a = await chainSecretFor(await makeNode('ru-01'));
    const b = await chainSecretFor(await makeNode('se-01'));
    expect(a).not.toBe(b);
  });

  it('survives two renders racing for it', async () => {
    // Both callers must come away with the same string. The write is a
    // compare-and-set on NULL rather than an overwrite, so a loser re-reads the
    // winner instead of replacing it.
    const nodeId = await makeNode();
    const [x, y, z] = await Promise.all([
      chainSecretFor(nodeId),
      chainSecretFor(nodeId),
      chainSecretFor(nodeId),
    ]);
    expect(y).toBe(x);
    expect(z).toBe(x);
  });

  it('never appears in a node response', async () => {
    const nodeId = await makeNode();
    const secret = await chainSecretFor(nodeId);

    for (const url of ['/api/nodes', `/api/nodes/${nodeId}`]) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      // Over the RAW body: a check on named fields only covers the fields
      // somebody thought to name, and this is precisely the kind of value that
      // arrives by way of a field nobody listed.
      expect(res.body).not.toContain(secret);
      expect(res.body).not.toContain('chainSecret');
      expect(res.body).not.toContain('chain_secret');
    }
  });

  it('is read back only by an authenticated admin', async () => {
    const nodeId = await makeNode();
    const secret = await chainSecretFor(nodeId);

    const anonymous = await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}/chain-secret` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).not.toContain(secret);

    const admin = await app.inject({
      method: 'GET',
      url: `/api/nodes/${nodeId}/chain-secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toEqual({ secret });
  });

  it('does not mint one just because somebody asked to see it', async () => {
    // The acceptance endpoint READS. If it minted, opening the screen would
    // create a credential for a node that has no chain, and the column would
    // stop meaning "this node has rendered a chain".
    const nodeId = await makeNode();
    const res = await app.inject({
      method: 'GET',
      url: `/api/nodes/${nodeId}/chain-secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toEqual({ secret: null });
    const row = await prisma.node.findUnique({
      where: { id: nodeId },
      select: { chainSecret: true },
    });
    expect(row?.chainSecret ?? null).toBeNull();
  });
});
