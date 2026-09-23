import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * The hysteria entry, phase 6: the two refusals it brings.
 *
 *   - ENTRY_CANNOT_CHAIN. A hysteria entry reaches the cascade only through the
 *     chain process on the same machine. A node that reported its engines in
 *     full without sing-box cannot run one, and a cascade on it would exist on
 *     the screen and carry nobody. Refused by FACT only: a node that has said
 *     nothing is let through, exactly like the cells of phase 5.
 *
 *   - ENTRY_CHANGE_DROPS_USERS. One protocol per entry, by decision. Switching
 *     it takes the users of the old protocol on the entry nodes out of the
 *     cascade, and they leave straight from the entry country. Allowed, and
 *     SAID: refused with the list of who leaves, accepted when the same save
 *     comes back with `confirmEntryChange: true`.
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

const XRAY_CONFIG = {
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

async function makeNode(name: string): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `${name}-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** What the node said about itself: its cores, each naming its engine. */
async function reportEngines(nodeId: string, engines: string[]) {
  await prisma.node.update({
    where: { id: nodeId },
    data: {
      cores: {
        observedAt: new Date().toISOString(),
        cores: engines.map((engine) => ({ name: engine, engine, running: true })),
      } as unknown as object,
    },
  });
}

async function bindProfile(nodeId: string, name: string, protocol = 'xray', config: unknown = XRAY_CONFIG) {
  const p = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name, protocol, config },
  });
  expect(p.statusCode, p.body).toBe(201);
  seq += 1;
  const b = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId: JSON.parse(p.body).id, nodeId, port: 10000 + seq },
  });
  expect(b.statusCode, b.body).toBe(201);
}

function body(entry: string, exit: string, entryProtocol: string) {
  return {
    positions: [{ position: 0, nodeIds: [entry], entryProtocol, linkProtocol: 'vless' }],
    directions: [{ countryCode: 'NL', nodeIds: [exit] }],
  };
}

async function create(entry: string, exit: string, entryProtocol: string) {
  seq += 1;
  return app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: { name: `ru-out-${seq}`, enabled: true, ...body(entry, exit, entryProtocol) },
  });
}

async function put(id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: `/api/cascades/${id}`, headers: auth(), payload });
}

describe('a hysteria entry on a node that cannot run the chain', () => {
  it('is refused with 409 ENTRY_CANNOT_CHAIN, naming the node and what it reported', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await reportEngines(entry, ['xray']);

    const res = await create(entry, exit, 'hysteria');
    expect(res.statusCode, res.body).toBe(409);
    const b = JSON.parse(res.body);
    expect(b.error).toBe('ENTRY_CANNOT_CHAIN');
    expect(b.conflicts).toEqual([{ nodeName: 'ru-entry', engines: ['xray'] }]);
    expect(b.message).toContain('ru-entry');
    expect(b.message).toContain('sing-box');
    expect(await prisma.cascade.count()).toBe(0);
  });

  it('lets it through when sing-box is among the engines', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await reportEngines(entry, ['xray', 'singbox']);
    const res = await create(entry, exit, 'hysteria');
    expect(res.statusCode, res.body).toBe(201);
  });

  it('lets it through when the node has said nothing, because that is not a no', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    const res = await create(entry, exit, 'hysteria');
    expect(res.statusCode, res.body).toBe(201);
  });

  it('does not ask this of an xray entry, which still has its legacy drawing', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await reportEngines(entry, ['xray']);
    const res = await create(entry, exit, 'xray');
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe('switching the entry protocol', () => {
  it('asks before it takes xray users out of the cascade, and names them', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru');
    const created = await create(entry, exit, 'xray');
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);

    const res = await put(c.id, body(entry, exit, 'hysteria'));
    expect(res.statusCode, res.body).toBe(409);
    const b = JSON.parse(res.body);
    // The exact shape the screen parses (refusedEntryChange on the frontend).
    expect(b.error).toBe('ENTRY_CHANGE_DROPS_USERS');
    expect(b.conflicts).toEqual([{ nodeName: 'ru-entry', profileName: 'reality-ru' }]);
    expect(b.from).toBe('xray');
    expect(b.to).toBe('hysteria');
    // Nothing moved: the entry is still xray.
    const stored = await prisma.cascadePosition.findFirst({
      where: { cascadeId: c.id, position: 0 },
      select: { entryProtocol: true },
    });
    expect(stored!.entryProtocol).toBe('xray');
  });

  it('goes through when the same save comes back with confirmEntryChange', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru');
    const c = JSON.parse((await create(entry, exit, 'xray')).body);

    const res = await put(c.id, { ...body(entry, exit, 'hysteria'), confirmEntryChange: true });
    expect(res.statusCode, res.body).toBe(200);
    const stored = await prisma.cascadePosition.findFirst({
      where: { cascadeId: c.id, position: 0 },
      select: { entryProtocol: true },
    });
    expect(stored!.entryProtocol).toBe('hysteria');
  });

  it('asks again on the NEXT switch: the consent lived for one request', async () => {
    // A flag that stuck would let a later edit move people with no question.
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru');
    await bindProfile(entry, 'hy2-ru', 'hysteria', {});
    const c = JSON.parse((await create(entry, exit, 'xray')).body);

    const first = await put(c.id, { ...body(entry, exit, 'hysteria'), confirmEntryChange: true });
    expect(first.statusCode, first.body).toBe(200);
    const back = await put(c.id, body(entry, exit, 'xray'));
    expect(back.statusCode, back.body).toBe(409);
    expect(JSON.parse(back.body).conflicts).toEqual([{ nodeName: 'ru-entry', profileName: 'hy2-ru' }]);
  });

  it('does not ask when nobody is standing on the old protocol', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    const c = JSON.parse((await create(entry, exit, 'xray')).body);
    const res = await put(c.id, body(entry, exit, 'hysteria'));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('does not ask about an edit that keeps the protocol', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru');
    const c = JSON.parse((await create(entry, exit, 'xray')).body);
    const res = await put(c.id, body(entry, exit, 'xray'));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses a switch to a node that cannot chain BEFORE asking for consent', async () => {
    // Asking the operator to confirm a switch that is then refused anyway
    // would be a question with no useful answer.
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru');
    const c = JSON.parse((await create(entry, exit, 'xray')).body);
    await reportEngines(entry, ['xray']);

    const res = await put(c.id, body(entry, exit, 'hysteria'));
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).error).toBe('ENTRY_CANNOT_CHAIN');
  });
});
