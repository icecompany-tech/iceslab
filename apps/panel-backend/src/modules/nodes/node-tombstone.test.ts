import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { signHeartbeatToken } from './heartbeat-token.js';

/**
 * A-279: a deleted node keeps its id and heartbeat secret and nothing else
 * secret. The row stays for good, and the agent removes itself only on the
 * 410 its still valid heartbeat token gets; the chain password, the
 * self-signed pair, the WARP credentials and the key material go.
 */
let app: FastifyInstance;
let admin: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  admin = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const SECRET_FIELDS = { chainSecret: true, hysteriaTls: true, warpAccount: true, publicKey: true } as const;

async function nodeWithSecrets(name: string, deletedAt: Date | null = null) {
  const heartbeatSecret = randomBytes(32);
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}.example.test:1337`,
      protocol: 'xray',
      heartbeatSecret,
      chainSecret: randomBytes(32),
      hysteriaTls: { certPem: 'cert', keyPem: 'PRIVATE KEY', host: '203.0.113.9' },
      warpAccount: { secretKey: 'warp-secret', token: 'warp-token', license: 'warp-license' },
      publicKey: randomBytes(32),
      deletedAt,
    },
    select: { id: true },
  });
  return { id: n.id, heartbeatSecret };
}

const heartbeat = (token: string) =>
  app.inject({ method: 'GET', url: '/api/internal/nodes/me/status', headers: { authorization: `Bearer ${token}` } });

describe('deleting a node leaves a tombstone', () => {
  it('clears the secrets, keeps the heartbeat secret, and the agent still gets its 410', async () => {
    const { id, heartbeatSecret } = await nodeWithSecrets('de-01');
    const token = signHeartbeatToken(id, heartbeatSecret);
    expect((await heartbeat(token)).statusCode).toBe(200);

    const res = await app.inject({ method: 'DELETE', url: `/api/nodes/${id}`, headers: { authorization: `Bearer ${admin}` } });
    expect(res.statusCode, res.body).toBe(204);

    const row = await prisma.node.findUniqueOrThrow({
      where: { id },
      select: { ...SECRET_FIELDS, heartbeatSecret: true, deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
    expect({ chainSecret: row.chainSecret, hysteriaTls: row.hysteriaTls, warpAccount: row.warpAccount, publicKey: row.publicKey }).toEqual({
      chainSecret: null,
      hysteriaTls: null,
      warpAccount: null,
      publicKey: null,
    });
    expect(Buffer.from(row.heartbeatSecret as Uint8Array).equals(heartbeatSecret)).toBe(true);

    const gone = await heartbeat(token);
    expect(gone.statusCode).toBe(410);
    expect(JSON.parse(gone.body).error).toBe('GONE');
  });

  it('a live node keeps its secrets', async () => {
    const { id } = await nodeWithSecrets('nl-01');
    const row = await prisma.node.findUniqueOrThrow({ where: { id }, select: SECRET_FIELDS });
    expect(Object.values(row).every((v) => v !== null)).toBe(true);
  });
});

/**
 * The migration that clears the same on nodes deleted before deleteNode did,
 * run on the rows: a deleted node loses its secrets, a live one keeps them.
 * Inside a transaction rolled back at the end.
 */
describe('20261026100207_deleted_node_secrets', () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../prisma/migrations/20261026100207_deleted_node_secrets/migration.sql'),
    'utf8',
  );
  const forward = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/;\s*$/, '');

  class Rollback extends Error {}

  it('is one UPDATE, limited to deleted rows, that clears the four fields', async () => {
    expect(forward).toMatch(/^UPDATE "nodes"/);
    expect(forward).toMatch(/WHERE "deleted_at" IS NOT NULL$/);
    const deleted = await nodeWithSecrets('old-gone', new Date(Date.now() - 86_400_000));
    const live = await nodeWithSecrets('still-here');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(forward);
        const gone = await tx.node.findUniqueOrThrow({ where: { id: deleted.id }, select: { ...SECRET_FIELDS, heartbeatSecret: true } });
        expect([gone.chainSecret, gone.hysteriaTls, gone.warpAccount, gone.publicKey]).toEqual([null, null, null, null]);
        expect(Buffer.from(gone.heartbeatSecret as Uint8Array).equals(deleted.heartbeatSecret)).toBe(true);
        const kept = await tx.node.findUniqueOrThrow({ where: { id: live.id }, select: SECRET_FIELDS });
        expect(Object.values(kept).every((v) => v !== null)).toBe(true);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
