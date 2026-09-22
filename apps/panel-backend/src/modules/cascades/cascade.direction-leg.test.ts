import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { LINK_PORT_BASE } from './cascade.config.js';

/**
 * What a direction says about its own leg, on the wire.
 *
 * The three fields were stored and rendered a commit before they were
 * reported, which is the hole this closes: the operator picked a tuic leg, the
 * panel saved it, the node listened for it, and reading the cascade back
 * answered as if the choice had never been made. A screen cannot show a value
 * it is not sent, so the next edit would have silently reset the leg to the
 * entry's cell.
 *
 * Every case here is about the SHAPE of the answer rather than the value:
 * `linkProtocol: null` is a value ("the entry's cell") and a missing key is a
 * feature that has not shipped. JSON drops undefined, so the two look the same
 * to a client and the assertions are on `Object.keys` rather than on the
 * properties, which would pass for a key present and undefined.
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

/** The three keys a direction must always carry, together. */
const LEG_KEYS = ['linkProtocol', 'linkParams', 'linkPort'];

interface DirectionDto {
  tag: number;
  linkProtocol: string | null;
  linkParams: { congestion?: string } | null;
  linkPort: number | null;
}

async function makeNode(name: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `leg-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** One entry and two directions: one that names its own cell, one that names
 *  none and is therefore reached over the entry's. */
async function makeCascade(entry: string, nl: string, se: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: 'ru-out',
      enabled: true,
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
      directions: [
        { tag: 1, countryCode: 'NL', nodeIds: [nl], linkProtocol: 'tuic', linkParams: { congestion: 'cubic' } },
        { tag: 2, countryCode: 'SE', nodeIds: [se] },
      ],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

const byTag = (dto: { directions: DirectionDto[] }) =>
  new Map(dto.directions.map((d) => [d.tag, d]));

describe('the leg of a direction, as the panel reports it', () => {
  it('answers all three keys on create, on read and in the list alike', async () => {
    // Three paths, one mapper, and the screen reads the second and third. A
    // create that answers and a read that does not is the worst of the three
    // outcomes: the form looks right until the page is reloaded.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const created = await makeCascade(entry, nl, se);

    const read = await app.inject({
      method: 'GET',
      url: `/api/cascades/${created.id}`,
      headers: auth(),
    });
    expect(read.statusCode, read.body).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/api/cascades', headers: auth() });
    expect(listed.statusCode, listed.body).toBe(200);

    for (const dto of [created, JSON.parse(read.body), JSON.parse(listed.body).cascades[0]]) {
      for (const d of dto.directions as DirectionDto[]) {
        expect(Object.keys(d), `tag ${d.tag} is missing a leg key`).toEqual(
          expect.arrayContaining(LEG_KEYS),
        );
      }
    }
  });

  it('reports the cell and the knob the operator chose', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const dirs = byTag(await makeCascade(entry, nl, se));

    expect(dirs.get(1)!.linkProtocol).toBe('tuic');
    expect(dirs.get(1)!.linkParams).toEqual({ congestion: 'cubic' });
  });

  it('reports null for the direction that named no cell, and it is a VALUE', async () => {
    // Null here reads "the entry's cell", which is what every direction did
    // before the field existed. It is reported rather than omitted so the form
    // can offer that as a choice instead of an empty control.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const dirs = byTag(await makeCascade(entry, nl, se));

    expect(dirs.get(2)!.linkProtocol).toBeNull();
    expect(dirs.get(2)!.linkParams).toBeNull();
    expect(Object.keys(dirs.get(2)!)).toEqual(expect.arrayContaining(LEG_KEYS));
  });

  it('reports the port as a number once the cascade is saved, and the same one for both', async () => {
    // Read-only: derived from the shape of the path, never taken from a
    // request. Both directions share it because a direction is not a step of
    // its own, so the leg into either terminates on the step after the last
    // position.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const dirs = byTag(await makeCascade(entry, nl, se));

    expect(dirs.get(1)!.linkPort).toBe(LINK_PORT_BASE);
    expect(dirs.get(2)!.linkPort).toBe(LINK_PORT_BASE);
  });

  it('keeps the port the server derived when a request tries to set another', async () => {
    // The field is in the DTO and a client will send the whole DTO back. What
    // arrives is dropped by the schema, so a round trip cannot move a leg onto
    // a port the node uses for something else.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const created = await makeCascade(entry, nl, se);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${created.id}`,
      headers: auth(),
      payload: {
        name: 'ru-out',
        // Sent as a client would: the whole direction back, `linkPort` included
        // and moved. The positions are rebuilt rather than echoed because their
        // DTO carries `entryProtocol: null` on a transit, and the position
        // schema takes that field as optional, not nullable. That asymmetry is
        // a separate question and not this test's.
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' },
        ],
        directions: (created.directions as DirectionDto[]).map((d) => ({
          ...d,
          linkPort: 65000,
        })),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    for (const d of byTag(JSON.parse(res.body)).values()) {
      expect(d.linkPort).toBe(LINK_PORT_BASE);
    }
  });

  it('answers the three keys for a direction stored before the columns existed', async () => {
    // The row every deployed panel has: three NULLs and no backfill. It must
    // read as "no choice made", not as a cascade whose answer is missing a
    // field, or a screen would decide the feature never shipped and hide the
    // control for every cascade saved before today.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const created = await makeCascade(entry, nl, se);

    await prisma.cascadeDirection.updateMany({
      data: { linkProtocol: null, linkParams: Prisma.DbNull, linkPort: null },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/cascades/${created.id}`,
      headers: auth(),
    });
    expect(res.statusCode, res.body).toBe(200);
    for (const d of (JSON.parse(res.body).directions as DirectionDto[])) {
      expect(Object.keys(d)).toEqual(expect.arrayContaining(LEG_KEYS));
      expect(d.linkProtocol).toBeNull();
      expect(d.linkParams).toBeNull();
      expect(d.linkPort).toBeNull();
    }
  });

  it('reports nothing rather than the contents of a jsonb column that is not knobs', async () => {
    /**
     * jsonb is not a type. The column can hold an array, a number, a string or
     * an object whose `congestion` is itself an object, and Prisma types all of
     * it as JsonValue. Whatever is there travels to a screen that reads the
     * key as a word, so anything unreadable answers "no knobs" instead of
     * itself.
     *
     * The row gets there by hand here, and by a hand in psql in the field. Both
     * are the same case: the mapper is the only thing between the column and
     * the client.
     */
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const created = await makeCascade(entry, nl, se);

    for (const junk of [['cubic'], 42, 'cubic', { congestion: { name: 'cubic' } }]) {
      await prisma.cascadeDirection.updateMany({
        where: { tag: 1 },
        data: { linkParams: junk as never },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/cascades/${created.id}`,
        headers: auth(),
      });
      const d = byTag(JSON.parse(res.body)).get(1)!;
      expect(d.linkParams, `${JSON.stringify(junk)} travelled through`).toBeNull();
      expect(Object.keys(d)).toEqual(expect.arrayContaining(LEG_KEYS));
    }
  });
});
