import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { MAX_DIRECTION_TAG } from './cascade.schemas.js';

/**
 * A-001: the direction tag stops at MAX_DIRECTION_TAG.
 *
 * The tag is the low byte of the route tag. Tag 257 would be read as tag 1 of
 * the next route policy, and the users of the new direction would leave
 * through the first one's country with nothing to say so. A save that needs a
 * tag past the ceiling is refused whole, and the counter does not move: tags
 * are never reused, so a refused save must not spend them either.
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

async function makeNode(name: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `tags-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const positions = (entry: string) => [
  { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' },
];

/** What a save may change, read straight from the tables. */
async function snapshot(cascadeId: string) {
  const cascade = await prisma.cascade.findUniqueOrThrow({
    where: { id: cascadeId },
    select: { nextDirectionTag: true },
  });
  const directions = await prisma.cascadeDirection.findMany({
    where: { cascadeId },
    select: { id: true, tag: true, nodes: { select: { nodeId: true } } },
    orderBy: { tag: 'asc' },
  });
  const links = await prisma.cascadeLink.findMany({
    where: { cascadeId },
    select: { fromNodeId: true, toNodeId: true, directionTag: true, config: true },
    orderBy: [{ directionTag: 'asc' }, { toNodeId: 'asc' }],
  });
  return { nextDirectionTag: cascade.nextDirectionTag, directions, links };
}

describe('direction tags at the ceiling', () => {
  async function cascadeNearTheCeiling() {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const res = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: false,
        positions: positions(entry),
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = JSON.parse(res.body).id as string;
    // A cascade that has spent every tag but the last, the way a long life of
    // deleted and recreated directions would leave it.
    await prisma.cascade.update({ where: { id }, data: { nextDirectionTag: MAX_DIRECTION_TAG } });
    return { id, entry, nl };
  }

  const save = (id: string, entry: string, directions: { countryCode: string; nodeIds: string[] }[]) =>
    app.inject({
      method: 'PUT',
      url: `/api/cascades/${id}`,
      headers: auth(),
      payload: { name: 'ru-out', positions: positions(entry), directions },
    });

  it(`hands out tag ${MAX_DIRECTION_TAG}, the last one`, async () => {
    const { id, entry, nl } = await cascadeNearTheCeiling();
    const se = await makeNode('se-exit');
    const res = await save(id, entry, [
      { countryCode: 'NL', nodeIds: [nl] },
      { countryCode: 'SE', nodeIds: [se] },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const after = await snapshot(id);
    expect(after.directions.map((d) => d.tag)).toEqual([1, MAX_DIRECTION_TAG]);
    expect(after.nextDirectionTag).toBe(MAX_DIRECTION_TAG + 1);
  });

  it(`refuses tag ${MAX_DIRECTION_TAG + 1} and writes nothing`, async () => {
    const { id, entry, nl } = await cascadeNearTheCeiling();
    const se = await makeNode('se-exit');
    const de = await makeNode('de-exit');
    const ok = await save(id, entry, [
      { countryCode: 'NL', nodeIds: [nl] },
      { countryCode: 'SE', nodeIds: [se] },
    ]);
    expect(ok.statusCode, ok.body).toBe(200);
    const before = await snapshot(id);

    // SE dropped and DE added in one save: were it written, SE's row and leg
    // would be gone too, so "nothing written" is checked on both.
    const res = await save(id, entry, [
      { countryCode: 'NL', nodeIds: [nl] },
      { countryCode: 'DE', nodeIds: [de] },
    ]);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'DIRECTION_TAGS_EXHAUSTED',
      needed: 1,
      available: 0,
    });
    expect(await snapshot(id)).toEqual(before);
  });

  it('refuses a save that would cross the ceiling partway, and spends no tag', async () => {
    // One tag left, two asked for: the first would fit, and is not handed out
    // either, since the save is refused whole.
    const { id, entry, nl } = await cascadeNearTheCeiling();
    const before = await snapshot(id);
    const se = await makeNode('se-exit');
    const de = await makeNode('de-exit');
    const res = await save(id, entry, [
      { countryCode: 'NL', nodeIds: [nl] },
      { countryCode: 'SE', nodeIds: [se] },
      { countryCode: 'DE', nodeIds: [de] },
    ]);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'DIRECTION_TAGS_EXHAUSTED', needed: 2, available: 1 });
    expect(await snapshot(id)).toEqual(before);
  });

  it('still saves a cascade at the ceiling that adds no direction', async () => {
    // Spent is not frozen: the directions it has keep their tags and can be
    // edited, only a new one has nowhere to go.
    const { id, entry, nl } = await cascadeNearTheCeiling();
    await prisma.cascade.update({ where: { id }, data: { nextDirectionTag: MAX_DIRECTION_TAG + 1 } });
    const res = await save(id, entry, [{ countryCode: 'DE', nodeIds: [nl] }]);
    expect(res.statusCode, res.body).toBe(200);
    expect((await snapshot(id)).directions.map((d) => d.tag)).toEqual([1]);
  });
});
