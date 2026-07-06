import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

let app: FastifyInstance;
let adminToken: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  adminToken = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('POST /api/api-tokens', () => {
  it('mints a token and reveals plaintext once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('bot');
    expect(body.token).toMatch(/^icp_[A-Za-z0-9_-]+$/);
    expect(body.id).toBeDefined();

    // Subsequent list does NOT include plaintext.
    const list = await app.inject({
      method: 'GET',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.body).tokens[0];
    expect(listed.token).toBeUndefined();
    expect(listed.name).toBe('bot');
  });

  it('rejects duplicate names', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    expect(dup.statusCode).toBe(409);
  });
});

describe('Bearer icp_* auth', () => {
  it('lets API token caller access /api/users', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    const apiToken: string = JSON.parse(create.body).token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).users).toEqual(expect.any(Array));
  });

  it('rejects unknown icp_* token with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: 'Bearer icp_definitely_not_a_real_token_12345' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('blocks API tokens from managing other API tokens', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    const apiToken: string = JSON.parse(create.body).token;

    // A leaked token should not be able to mint more.
    const escalation = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { name: 'evil' },
    });
    expect(escalation.statusCode).toBe(403);

    // Or revoke itself / others.
    const list = await app.inject({
      method: 'GET',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(list.statusCode).toBe(403);
  });

  it('updates lastUsedAt after a successful API-token request', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    const tokenId: string = JSON.parse(create.body).id;
    const apiToken: string = JSON.parse(create.body).token;

    expect(
      (await prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } }))
        .lastUsedAt,
    ).toBeNull();

    await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${apiToken}` },
    });

    // Update is fire-and-forget, give the event loop a tick to flush.
    await new Promise((r) => setTimeout(r, 50));

    const reloaded = await prisma.apiToken.findUniqueOrThrow({
      where: { id: tokenId },
    });
    expect(reloaded.lastUsedAt).not.toBeNull();
  });
});

describe('DELETE /api/api-tokens/:id', () => {
  it('revokes the token immediately', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'bot' },
    });
    const tokenId: string = JSON.parse(create.body).id;
    const apiToken: string = JSON.parse(create.body).token;

    // Token works...
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/users',
          headers: { authorization: `Bearer ${apiToken}` },
        })
      ).statusCode,
    ).toBe(200);

    // ...admin revokes it...
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${tokenId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(204);

    // ...next call from the revoked token gets 401.
    const after = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(after.statusCode).toBe(401);
  });
});
