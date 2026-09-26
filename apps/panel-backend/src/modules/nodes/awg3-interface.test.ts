import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AmneziawgInboundCfg } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { fetchEnabledInbounds } from '../inbounds/inbounds.queue.js';
import { awg3GeometryViolations, ensureAwg3Geometry } from './awg3-geometry.js';
import { subnetsOverlap } from './node-core-gate.js';

/**
 * t07-6: a 3.1 profile on a node is pushed as the node's 3.1 interface, with
 * the geometry the panel minted for that node, beside the 1.x interface of a
 * 1.x profile, which pushes exactly as before plus its binding id.
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
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: auth(), payload });

async function makeNode(): Promise<string> {
  seq += 1;
  const res = await post('/api/nodes', { name: `awg-${seq}`, address: `awg-${seq}.test`, protocol: 'xray' });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function awgProfile(awgProtocol: 1 | 3, subnet: string): Promise<string> {
  seq += 1;
  const res = await post('/api/profiles', {
    name: `awg-p-${seq}`,
    protocol: 'amneziawg',
    awgProtocol,
    config: { serverPrivateKey: 'a'.repeat(43) + '=', serverPublicKey: 'b'.repeat(43) + '=', subnet, obfuscation: {} },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const bind = (profileId: string, nodeId: string, port: number) => post('/api/bindings', { profileId, nodeId, port });

describe('the push of a node with both generations', () => {
  it('carries the 3.1 inbound with the node geometry, and the 1.x one as before', async () => {
    const nodeId = await makeNode();
    const p1 = await awgProfile(1, '10.66.66.0/24');
    const p3 = await awgProfile(3, '10.67.67.0/24');
    expect((await bind(p1, nodeId, 51820)).statusCode).toBe(201);
    expect((await bind(p3, nodeId, 51830)).statusCode).toBe(201);

    const inbounds = await fetchEnabledInbounds(nodeId);
    const awg = inbounds.filter((i) => i.protocol === 'amneziawg');
    const one = awg.find((i) => i.port === 51820)!.config as AmneziawgInboundCfg;
    const three = awg.find((i) => i.port === 51830)!.config as AmneziawgInboundCfg;

    expect(one.awgProtocol).toBeUndefined();
    expect(one.geometry3).toBeUndefined();
    expect(one.inboundId).toBe(awg.find((i) => i.port === 51820)!.id);

    expect(three.awgProtocol).toBe(3);
    expect(awg3GeometryViolations(three.geometry3!)).toEqual([]);
    const stored = await prisma.node.findUniqueOrThrow({ where: { id: nodeId }, select: { awg3Geometry: true } });
    expect(three.geometry3).toEqual(stored.awg3Geometry);

    // The next push carries the same geometry: minted once, never quietly again.
    const again = (await fetchEnabledInbounds(nodeId)).find((i) => i.port === 51830)!.config as AmneziawgInboundCfg;
    expect(again.geometry3).toEqual(three.geometry3);
  });

  it('mints nothing for a node with 1.x alone', async () => {
    const nodeId = await makeNode();
    expect((await bind(await awgProfile(1, '10.66.66.0/24'), nodeId, 51820)).statusCode).toBe(201);
    await fetchEnabledInbounds(nodeId);
    const n = await prisma.node.findUniqueOrThrow({ where: { id: nodeId }, select: { awg3Geometry: true } });
    expect(n.awg3Geometry).toBeNull();
  });

  it('two pushes minting at once end on one geometry', async () => {
    const nodeId = await makeNode();
    const [a, b, c] = await Promise.all([ensureAwg3Geometry(nodeId), ensureAwg3Geometry(nodeId), ensureAwg3Geometry(nodeId)]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

describe('the subnets of the two interfaces', () => {
  it('refuses a 3.1 profile onto a node whose 1.x profile has the same subnet, in machine form', async () => {
    const nodeId = await makeNode();
    expect((await bind(await awgProfile(1, '10.66.66.0/24'), nodeId, 51820)).statusCode).toBe(201);
    const res = await bind(await awgProfile(3, '10.66.66.0/24'), nodeId, 51830);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'AWG_SUBNET_OVERLAP',
      subnet: '10.66.66.0/24',
      otherSubnet: '10.66.66.0/24',
    });
    // The hosts door, which creates the binding under a host, the same.
    const viaHost = await post('/api/hosts', {
      profileId: await awgProfile(3, '10.66.0.0/16'),
      nodeId,
      port: 51831,
      remark: 'h',
    });
    expect(viaHost.statusCode, viaHost.body).toBe(409);
    expect(JSON.parse(viaHost.body).error).toBe('AWG_SUBNET_OVERLAP');
  });

  it('lets through subnets apart, and does not ask about the same generation', async () => {
    const nodeId = await makeNode();
    expect((await bind(await awgProfile(1, '10.66.66.0/24'), nodeId, 51820)).statusCode).toBe(201);
    expect((await bind(await awgProfile(3, '10.67.67.0/24'), nodeId, 51830)).statusCode).toBe(201);
    expect((await bind(await awgProfile(1, '10.66.66.0/24'), nodeId, 51821)).statusCode).toBe(201);
  });

  it('reads overlap as networks, not strings', () => {
    expect(subnetsOverlap('10.66.0.0/16', '10.66.66.0/24')).toBe(true);
    expect(subnetsOverlap('10.66.66.0/24', '10.66.67.0/24')).toBe(false);
    expect(subnetsOverlap('10.66.66.128/25', '10.66.66.0/25')).toBe(false);
  });
});
