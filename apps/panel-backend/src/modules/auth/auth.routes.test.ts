import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAdmin, registerAndLogin } from '../../../tests/helpers/auth.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('POST /api/auth/register', () => {
  it('creates the first admin and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'admin', password: 'password123' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('admin');
    expect(body.role).toBe('admin');
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('returns 403 when an admin already exists', async () => {
    await registerAdmin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'second', password: 'password123' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('REGISTRATION_DISABLED');
  });

  it('returns 400 on invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'x', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('returns admin and JWT on valid credentials', async () => {
    await registerAdmin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.admin.username).toBe('admin');
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);
  });

  it('returns 401 on wrong password', async () => {
    await registerAdmin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for unknown username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'whatever' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/auth/status', () => {
  it('reports registration enabled when no admins exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.authentication.password.enabled).toBe(true);
    expect(body.registration.enabled).toBe(true);
  });

  it('reports registration disabled once an admin exists', async () => {
    await registerAdmin(app);
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).registration.enabled).toBe(false);
  });

  it('is publicly accessible (no auth required)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated admin', async () => {
    const token = await registerAndLogin(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).username).toBe('admin');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
