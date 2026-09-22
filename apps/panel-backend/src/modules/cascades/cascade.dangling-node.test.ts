import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * A cascade cannot be saved naming a node that is not there.
 *
 * Two guards, one hole each, and they are not the same hole. Deleting a node a
 * live cascade uses is refused now, which closes the road forward. This one
 * closes what is ALREADY stored: a cascade written before that guard carries a
 * dead id, the panel receives it as a nodeId with no row in the node list, and
 * "Save and push" sent it straight back. That is the state the cascade was in
 * on 2026-09-22, and every push to its entries failed for a day afterwards.
 *
 * The refusal names the DIRECTION, not only the uuid: the operator is looking
 * at a screen of named ways out, and the id belongs to a node that no longer
 * exists, so they cannot look it up either.
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

async function makeNode(name: string): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `dang-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

function payload(entry: string, exits: { id: string; cc: string }[], name = 'ru') {
  return {
    name,
    enabled: true,
    positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' }],
    directions: exits.map((e, i) => ({ tag: i + 1, countryCode: e.cc, nodeIds: [e.id] })),
  };
}

const save = (body: unknown) =>
  app.inject({ method: 'POST', url: '/api/cascades', headers: auth(), payload: body as never });

const update = (id: string, body: unknown) =>
  app.inject({ method: 'PUT', url: `/api/cascades/${id}`, headers: auth(), payload: body as never });

describe('a cascade that names a node the panel cannot find', () => {
  it('is refused on create, with the direction named', async () => {
    const entry = await makeNode('ru-01');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await prisma.node.update({ where: { id: se }, data: { deletedAt: new Date() } });

    const res = await save(payload(entry, [{ id: nl, cc: 'NL' }, { id: se, cc: 'SE' }]));
    expect(res.statusCode, res.body).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain(se);
    expect(body.message).toContain('direction "SE"');
  });

  it('is refused on UPDATE, which is where the incident came through', async () => {
    // The save that the panel let an operator press: the cascade already holds
    // the dead id, the screen shows it as a row it has no node for, and the
    // payload comes back unchanged.
    const entry = await makeNode('ru-01');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const created = await save(payload(entry, [{ id: nl, cc: 'NL' }, { id: se, cc: 'SE' }]));
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;

    // The node goes away behind the cascade's back, the way it did before the
    // delete guard existed.
    await prisma.node.update({ where: { id: se }, data: { deletedAt: new Date() } });

    const res = await update(id, payload(entry, [{ id: nl, cc: 'NL' }, { id: se, cc: 'SE' }]));
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).message).toContain('direction "SE"');
  });

  it('names a POSITION when the dangling id is a hop', async () => {
    const entry = await makeNode('ru-01');
    const nl = await makeNode('nl-exit');
    await prisma.node.update({ where: { id: entry }, data: { deletedAt: new Date() } });

    const res = await save(payload(entry, [{ id: nl, cc: 'NL' }]));
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).message).toContain('position 0');
  });

  it('saves normally when every node is there', async () => {
    const entry = await makeNode('ru-01');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');

    const created = await save(payload(entry, [{ id: nl, cc: 'NL' }, { id: se, cc: 'SE' }]));
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;

    const again = await update(id, payload(entry, [{ id: nl, cc: 'NL' }, { id: se, cc: 'SE' }]));
    expect(again.statusCode, again.body).toBe(200);
  });
});
