import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { matchStoredDirections, resolveDirections } from './direction-merge.js';

/**
 * An absent key is not a value, it is the absence of an edit.
 *
 * ⚠ REPRODUCED AGAINST THE LIVE API by FRONT on 2026-09-22, and the five steps
 * below are that reproduction, not an invention:
 *
 *     DE reached over the entry's cell, NL over hy2
 *     PUT carrying a leg for DE   ->  DE tuic/new_reno, NL NULL
 *     PUT carrying no leg fields  ->  DE NULL,          NL NULL
 *
 * Each save dropped the leg of a direction it did not mention. In the field
 * that is not a form bug: a direction's clients keep connecting and leave the
 * country over a different transport, under people, with nothing said anywhere.
 *
 * It is the incident of 2026-07-31 in a new place (a squad save sent a list the
 * screen did not edit and wiped `profileIds`), which is why the fix is the same
 * shape: what the client did not mention, the server does not touch.
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

interface DirectionDto {
  id: string;
  tag: number;
  countryCode: string | null;
  nodeIds: string[];
  linkProtocol: string | null;
  linkParams: { congestion?: string } | null;
}

async function makeNode(name: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `merge-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const byCountry = (dto: { directions: DirectionDto[] }) =>
  new Map(dto.directions.map((d) => [d.countryCode, d]));

async function put(id: string, payload: unknown) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cascades/${id}`,
    headers: auth(),
    payload: payload as Record<string, unknown>,
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body);
}

describe('what a PUT does not mention', () => {
  it('leaves the neighbouring direction its leg, step for step as FRONT reproduced it', async () => {
    const entry = await makeNode('ru-entry');
    const de = await makeNode('de-exit');
    const nl = await makeNode('nl-exit');

    // 1. DE over the entry's cell, NL over hy2.
    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
        ],
        directions: [
          { countryCode: 'DE', nodeIds: [de] },
          { countryCode: 'NL', nodeIds: [nl], linkProtocol: 'hy2' },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);
    const first = byCountry(c);
    expect(first.get('DE')!.linkProtocol).toBeNull();
    expect(first.get('NL')!.linkProtocol).toBe('hy2');

    // 2. A PUT that gives DE a leg and says nothing about NL's.
    const afterDe = await put(c.id, {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [
        {
          id: first.get('DE')!.id,
          countryCode: 'DE',
          nodeIds: [de],
          linkProtocol: 'tuic',
          linkParams: { congestion: 'new_reno' },
        },
        { id: first.get('NL')!.id, countryCode: 'NL', nodeIds: [nl] },
      ],
    });
    const second = byCountry(afterDe);
    expect(second.get('DE')!.linkProtocol).toBe('tuic');
    expect(second.get('DE')!.linkParams).toEqual({ congestion: 'new_reno' });
    // The line that was red: NL was answering null here.
    expect(second.get('NL')!.linkProtocol).toBe('hy2');

    // 3. A PUT with no leg fields at all. Both keep what they have.
    const afterNone = await put(c.id, {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [
        { id: first.get('DE')!.id, countryCode: 'DE', nodeIds: [de] },
        { id: first.get('NL')!.id, countryCode: 'NL', nodeIds: [nl] },
      ],
    });
    const third = byCountry(afterNone);
    expect(third.get('DE')!.linkProtocol).toBe('tuic');
    expect(third.get('DE')!.linkParams).toEqual({ congestion: 'new_reno' });
    expect(third.get('NL')!.linkProtocol).toBe('hy2');

    // And the tags never moved, which is what makes the rest of it matter: a
    // tag rides in the clients' UUIDs.
    expect([...third.values()].map((d) => d.tag).sort()).toEqual(
      [...first.values()].map((d) => d.tag).sort(),
    );
  });

  it('still clears a leg when the client says null, because that is an edit', async () => {
    // The other half. Without it the fix would be "the field can never be
    // unset", which is a different bug wearing the same comment.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
        ],
        directions: [
          { countryCode: 'NL', nodeIds: [nl], linkProtocol: 'tuic', linkParams: { congestion: 'cubic' } },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);

    const cleared = await put(c.id, {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [
        { id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl], linkProtocol: null, linkParams: null },
      ],
    });
    expect(cleared.directions[0].linkProtocol).toBeNull();
    expect(cleared.directions[0].linkParams).toBeNull();
  });

  it('keeps the pool of a direction whose nodeIds were not sent', async () => {
    // The same hole in the field that costs the most: an emptied pool stops the
    // direction serving without deleting it, so the screen says nothing
    // happened. `.default([])` in the schema used to make this unavoidable,
    // because zod filled the absence in before the service could see it.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);

    const after = await put(c.id, {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ id: c.directions[0].id, countryCode: 'NL' }],
    });
    expect(after.directions[0].nodeIds).toEqual([nl]);
    // An explicit empty pool is a choice, and since phase 10 a refused one
    // (ARCH 26.09): a direction with neither nodes nor an outbound is
    // DIRECTION_EMPTY, and the stored pool stays.
    const emptied = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${c.id}`,
      headers: auth(),
      payload: {
        positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
        directions: [{ id: c.directions[0].id, countryCode: 'NL', nodeIds: [] }],
      },
    });
    expect(emptied.statusCode, emptied.body).toBe(400);
    expect(JSON.parse(emptied.body)).toMatchObject({ error: 'DIRECTION_EMPTY', directionTag: 1, directionIndex: 0 });
  });

  it('keeps the country of a direction that was not asked about', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    const c = JSON.parse(created.body);

    const after = await put(c.id, {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ id: c.directions[0].id, nodeIds: [nl] }],
    });
    expect(after.directions[0].countryCode).toBe('NL');
  });
});

describe('the knobs of a POSITION leg', () => {
  /**
   * The half of the phase-5 contract that shipped late.
   *
   * `linkParams` was promised to a position exactly as to a direction, and the
   * migration gave it to directions only. So the leg BETWEEN two steps took the
   * default controller whatever the operator picked, and the screen had to say
   * "bbr, not selectable" in words rather than offer a control.
   */
  it('answers the key on every position, always', async () => {
    const entry = await makeNode('ru-entry');
    const transit = await makeNode('de-transit');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic', linkParams: { congestion: 'cubic' } },
          { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);

    for (const p of c.positions as { linkParams: unknown }[]) {
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['linkParams']));
    }
    expect(c.positions[0].linkParams).toEqual({ congestion: 'cubic' });
    // The one that chose nothing reads as the defaults, not as a missing field.
    expect(c.positions[1].linkParams).toBeNull();
  });

  it('reaches the credential of the leg it describes', async () => {
    // The point of the column: a knob nobody renders is a control that lies.
    const entry = await makeNode('ru-entry');
    const transit = await makeNode('de-transit');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic', linkParams: { congestion: 'new_reno' } },
          { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const leg = await prisma.cascadeLink.findFirstOrThrow({
      where: { toNodeId: transit },
      select: { config: true },
    });
    expect((leg.config as { protocol: string; congestion: string }).congestion).toBe('new_reno');
  });

  it('keeps the knob when a PUT does not mention it', async () => {
    // The same three states as the direction, and the same incident behind
    // them: a save that edits the pool must not silently reset the controller.
    const entry = await makeNode('ru-entry');
    const transit = await makeNode('de-transit');
    const nl = await makeNode('nl-exit');

    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic', linkParams: { congestion: 'cubic' } },
          { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    const c = JSON.parse(created.body);

    const kept = await put(c.id, {
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic' },
        { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
      ],
      directions: [{ id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl] }],
    });
    expect(kept.positions[0].linkParams).toEqual({ congestion: 'cubic' });

    // And an explicit null still clears it, or the rule would read as "this
    // field can never be unset".
    const cleared = await put(c.id, {
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic', linkParams: null },
        { position: 1, nodeIds: [transit], linkProtocol: 'vless' },
      ],
      directions: [{ id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl] }],
    });
    expect(cleared.positions[0].linkParams).toBeNull();
  });

  it('refuses a knob the engine does not take, on a position as on a direction', async () => {
    // One schema for both, so `brutal` is refused in both places or the two
    // would drift the way the congestion dictionary already did once.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const res = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: 'ru-out',
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'tuic', linkParams: { congestion: 'brutal' } },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe('the merge rule itself', () => {
  const stored = [
    {
      id: 'd-1',
      countryCode: 'NL',
      linkProtocol: 'hy2',
      linkParams: { congestion: 'cubic' },
      nodes: [{ nodeId: 'n-1' }],
    },
  ];
  const read = (s: (typeof stored)[number]) => ({
    countryCode: s.countryCode,
    linkProtocol: s.linkProtocol,
    linkParams: s.linkParams as { congestion: 'cubic' },
  });

  it('tells absent from null, which is the whole rule', () => {
    const [absent] = resolveDirections(stored, [{ id: 'd-1', nodeIds: ['n-1'] }], read);
    expect(absent!.linkProtocol).toBe('hy2');

    const [explicit] = resolveDirections(
      stored,
      [{ id: 'd-1', nodeIds: ['n-1'], linkProtocol: null }],
      read,
    );
    expect(explicit!.linkProtocol).toBeNull();
  });

  it('recognises a stored direction by its pool when no id was sent', () => {
    // The panel did not always send ids, and a direction that is not recognised
    // draws a fresh tag: the country its clients exit through moves under them.
    const [d] = resolveDirections(stored, [{ nodeIds: ['n-1'] }], read);
    expect(d!.id).toBe('d-1');
    expect(d!.linkProtocol).toBe('hy2');
  });

  it('gives one stored direction to at most one incoming direction', () => {
    const matches = matchStoredDirections(stored, [{ nodeIds: ['n-1'] }, { nodeIds: ['n-1'] }]);
    expect(matches[0]?.id).toBe('d-1');
    expect(matches[1]).toBeUndefined();
  });

  it('carries nothing forward for a direction that is genuinely new', () => {
    const [d] = resolveDirections(stored, [{ nodeIds: ['n-9'] }], read);
    expect(d!.id).toBeUndefined();
    expect(d!.linkProtocol).toBeUndefined();
    expect(d!.nodeIds).toEqual(['n-9']);
  });
});
