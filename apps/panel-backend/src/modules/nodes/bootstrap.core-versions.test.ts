import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CORE_VERSIONS, resolveCoreVersions } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * The node's intent reaches the installer through the payload: the panel
 * resolves Node.coreVersions against the manifest (resolveCoreVersions) and the
 * installer reads the block through `iceslab-node core-env` as defaults for the
 * bootstrap scripts. Both roads carry it: the one-time payload shown on create
 * and the one the bootstrap token redeems.
 */

const XRAY = CORE_VERSIONS.xray.pinned!;
const MTG = CORE_VERSIONS.mtg.pinned!;

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

async function createNode(extra: Record<string, unknown> = {}) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `bcv-${seq}`, address: `bcv-${seq}.test`, protocol: 'xray', ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string; payload: string; bootstrap: { token: string } };
}

function payloadOf(encoded: string) {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    coreVersions?: Record<string, { version: string; tag: string }>;
  };
}

const redeem = (t: string) => app.inject({ method: 'GET', url: `/api/internal/bootstrap/${t}` });

describe('the bootstrap payload carries the core versions', () => {
  it('on both roads, resolved from the intent with the pin for the rest', async () => {
    const node = await createNode({ coreVersions: { mtg: MTG } });

    // The one-time payload shown on create.
    expect(payloadOf(node.payload).coreVersions).toEqual(resolveCoreVersions({ mtg: MTG }));

    // The token the install command redeems.
    const redeemed = await redeem(node.bootstrap.token);
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const versions = payloadOf(redeemed.body).coreVersions!;
    expect(versions).toEqual(resolveCoreVersions({ mtg: MTG }));
    expect(versions.xray!.tag).toBe(`v${XRAY}`);
    // Nothing is pinned for naive, so nothing travels: the script keeps its way.
    expect(versions['caddy-naive']).toBeUndefined();
  });

  it('refuses an install whose stored choice stopped being listed, and keeps the token', async () => {
    const node = await createNode();
    await prisma.$executeRawUnsafe(
      `UPDATE nodes SET core_versions = '{"xray":"1.0.0"}'::jsonb WHERE id = '${node.id}'`,
    );
    const refused = await redeem(node.bootstrap.token);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(JSON.parse(refused.body).error).toBe('CORE_VERSION_NOT_LISTED');
    const row = await prisma.nodeBootstrapToken.findUnique({ where: { token: node.bootstrap.token } });
    expect(row?.consumedAt).toBeNull();

    // Put it back on the pin and the same token goes through.
    const reset = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${node.id}`,
      headers: auth(),
      payload: { coreVersions: { xray: null } },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect((await redeem(node.bootstrap.token)).statusCode).toBe(200);
  });
});
