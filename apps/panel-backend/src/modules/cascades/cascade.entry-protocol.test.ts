import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CHAIN_ENTRY_PROTOCOLS } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * What the entry may serve users with, refused at the save.
 *
 * The screen offered hysteria2 and AmneziaWG, the save accepted them, and the
 * value was then read by nobody: the render draws the xray chain whatever the
 * entry protocol says. So the cascade looked finished and did one of two silent
 * things. With an xray inbound on that node the chain was drawn there and the
 * hy2 users went out of the ENTRY node directly, past every exit and every
 * protection, while the panel showed them a cascade; with no xray inbound the
 * fragments were dropped with one INFO line and the cascade did nothing at all.
 *
 * Refused at the save because that is where somebody is standing. At render
 * time the operator left hours ago and the only trace is a log nobody reads.
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
    payload: { name, address: `${name}-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function save(entryProtocol: string, entry: string, exit: string) {
  seq += 1;
  return app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol, linkProtocol: 'xray' }],
      directions: [{ tag: 1, countryCode: 'NL', nodeIds: [exit] }],
    },
  });
}

describe('the protocol a cascade entry serves users with', () => {
  it('takes xray', async () => {
    const res = await save('xray', await makeNode('ru'), await makeNode('nl'));
    expect(res.statusCode, res.body).toBe(201);
  });

  it('takes hysteria since phase 6, on a node that has said nothing yet', async () => {
    // The node reported no cores at all, which is every node before its first
    // cascade. The chain block is sent BY this save, so refusing on the absence
    // would refuse every first hysteria cascade, forever.
    const res = await save('hysteria', await makeNode('ru-hy'), await makeNode('nl'));
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses amneziawg and says which phase carries it', async () => {
    const res = await save('amneziawg', await makeNode('ru-awg'), await makeNode('nl'));
    expect(res.statusCode, res.body).toBe(400);
    const body = JSON.parse(res.body);
    // The CODE is what the screen matches on, so it is asserted separately
    // from the sentence: a message can be reworded, the code cannot.
    expect(body.error).toBe('ENTRY_NOT_CHAINABLE');
    expect(body.message).toContain('amneziawg');
    expect(body.message).toContain('phase 7 (amneziawg)');
    // And no longer promises hysteria for a phase that has shipped.
    expect(body.message).not.toContain('phase 6');
    // Nothing was written: a refusal that leaves half a cascade behind is a
    // refusal the operator has to clean up after.
    expect(await prisma.cascade.count()).toBe(0);
  });

  it('is refused against the list the screen reads', async () => {
    // One list, shared. A second copy on the frontend is how a form comes to
    // offer an option the server rejects, and the operator learns the rule from
    // an error instead of from the control.
    expect([...CHAIN_ENTRY_PROTOCOLS]).toEqual(['xray', 'hysteria']);
  });
});
