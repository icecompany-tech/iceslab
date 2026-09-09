import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { prisma } from './prisma.js';
import { closeRedis } from './lib/infra/redis.js';
import { cleanDatabase } from '../tests/helpers/db.js';
import { registerAndLogin } from '../tests/helpers/auth.js';

/**
 * A POST with no fields is a normal request, not a malformed one.
 *
 * Several actions take no input at all: reset a user's traffic, revoke their
 * subscription. Fastify's default JSON parser rejects an empty body when the
 * request carries `Content-Type: application/json` - which every HTTP client
 * sends by default on a POST - so the most natural way to call them answered
 * 400, with nothing in the message about why. Found while driving the API by
 * hand (BACKLOG E16); a bot author would have hit it on their first attempt.
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

async function makeUser(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${token}` },
    payload: { username: 'body_probe' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

describe('an empty JSON body', () => {
  it('is accepted on an action that takes no input', async () => {
    const id = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${id}/reset-traffic`,
      headers: {
        authorization: `Bearer ${token}`,
        // The header every client sets by default, with nothing after it.
        'content-type': 'application/json',
      },
      payload: '',
    });
    // The regression: this used to be 400, and the body said nothing useful.
    expect(res.statusCode, res.body).toBeLessThan(300);
  });

  it('is still accepted when the caller sends no content-type at all', async () => {
    const id = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${id}/reset-traffic`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
  });
});

describe('a broken JSON body', () => {
  it('still fails loudly', async () => {
    // Tolerating "empty" must not turn into tolerating "garbage": a typo in a
    // payload has to be rejected, not silently read as no fields.
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: '{"username": "oops"',
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not read a broken payload as an empty one', async () => {
    // The dangerous shape of this bug: if malformed JSON parsed as {}, a
    // request meant to change something would be accepted as a no-op, or
    // create a record with defaults nobody asked for.
    const before = await prisma.user.count();
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: 'not json at all',
    });
    expect(await prisma.user.count()).toBe(before);
  });
});
