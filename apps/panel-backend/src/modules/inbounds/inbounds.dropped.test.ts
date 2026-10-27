import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { applyInboundsRequestForNode } from './inbounds.queue.js';

/**
 * A-281: the per-node `inbounds` table and `group_inbounds` are gone (a
 * deleted node's row kept its config, keys and all), and what replaced them
 * in slice 27 carries on: a profile on a node is what the node is pushed.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('after the drop', () => {
  it('neither table is in the database', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('inbounds', 'group_inbounds')`;
    expect(rows).toEqual([]);
  });

  it('a profile bound to a node is still what the node is pushed', async () => {
    const node = await prisma.node.create({
      data: { name: 'a281', address: 'a281.example.com', protocol: 'xray', heartbeatSecret: randomBytes(32) },
      select: { id: true },
    });
    const post = async (url: string, payload: unknown) => {
      const res = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
      expect(res.statusCode, res.body).toBe(201);
      return JSON.parse(res.body) as { id: string };
    };
    const profile = await post('/api/profiles', {
      name: 'a281-vless',
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
    });
    await post('/api/hosts', { profileId: profile.id, nodeId: node.id, port: 443 });
    const req = await applyInboundsRequestForNode(node.id);
    expect(req?.inbounds.map((i) => [i.name, i.port])).toEqual([['a281-vless', 443]]);
  });
});
