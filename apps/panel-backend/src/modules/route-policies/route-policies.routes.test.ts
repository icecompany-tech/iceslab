import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * Ad-split shipped in E1 as a mechanism with no way to operate it: the module
 * was list-only and its own comment called a create surface a fast-follow that
 * never came. Policies could only exist by hand-written SQL.
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

const auth = () => ({ authorization: `Bearer ${token}` });

const create = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/route-policies', headers: auth(), payload });

describe('POST /api/route-policies', () => {
  it('creates a policy and assigns the first free band', async () => {
    const res = await create({ name: 'No ads', blockDomains: ['geosite:category-ads-all'] });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    // Band 0 is the implicit plain profile and never a row, so extras start at 1.
    expect(body.ordinal).toBe(1);
    expect(body.blockDomains).toEqual(['geosite:category-ads-all']);
  });

  it('hands the next band to the next policy', async () => {
    await create({ name: 'No ads', blockDomains: ['geosite:category-ads-all'] });
    const second = await create({ name: 'RU direct', directDomains: ['geosite:ru'] });
    expect(JSON.parse(second.body).ordinal).toBe(2);
  });

  it('reuses a freed band, unlike direction tags', async () => {
    const first = JSON.parse((await create({ name: 'A', blockDomains: ['a.example'] })).body);
    await create({ name: 'B', blockDomains: ['b.example'] });
    await app.inject({
      method: 'DELETE',
      url: `/api/route-policies/${first.id}`,
      headers: auth(),
    });
    // A policy ordinal only means something while the policy exists: rules are
    // resolved fresh on every push, so a gap is safe to fill. Direction tags
    // are the opposite and must never be reused.
    const third = await create({ name: 'C', blockDomains: ['c.example'] });
    expect(JSON.parse(third.body).ordinal).toBe(1);
  });

  it('refuses a policy that would do nothing', async () => {
    const res = await create({ name: 'Empty' });
    expect(res.statusCode).toBe(400);
  });

  it('names which uniqueness was violated', async () => {
    await create({ name: 'No ads', blockDomains: ['geosite:category-ads-all'] });
    const dupName = await create({ name: 'No ads', blockDomains: ['x.example'] });
    expect(dupName.statusCode).toBe(409);
    expect(JSON.parse(dupName.body).message).toContain('named');

    const dupBand = await create({ name: 'Other', ordinal: 1, blockDomains: ['y.example'] });
    expect(dupBand.statusCode).toBe(409);
    expect(JSON.parse(dupBand.body).message).toContain('band');
  });
});

describe('PUT /api/route-policies/:id', () => {
  it('edits the domain lists', async () => {
    const p = JSON.parse((await create({ name: 'No ads', blockDomains: ['a.example'] })).body);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/route-policies/${p.id}`,
      headers: auth(),
      payload: { blockDomains: ['a.example', 'b.example'] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).blockDomains).toHaveLength(2);
  });

  it('ignores an attempt to move the band', async () => {
    const p = JSON.parse((await create({ name: 'No ads', blockDomains: ['a.example'] })).body);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/route-policies/${p.id}`,
      headers: auth(),
      payload: { ordinal: 7 },
    });
    // The band travels inside every subscriber's UUID; moving it would reroute
    // everyone already holding a link, so the field is not editable at all.
    expect(JSON.parse(res.body).ordinal).toBe(1);
  });

  it('404s on a policy that is not there', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/route-policies/00000000-0000-4000-8000-000000000000',
      headers: auth(),
      payload: { name: 'ghost' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/route-policies/:id', () => {
  it('removes it from the list', async () => {
    const p = JSON.parse((await create({ name: 'No ads', blockDomains: ['a.example'] })).body);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/route-policies/${p.id}`, headers: auth() }))
        .statusCode,
    ).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/route-policies', headers: auth() });
    expect(JSON.parse(list.body).policies).toHaveLength(0);
  });
});
