import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { getCascadeFragmentsForNode, getChainForNode } from './cascade.service.js';
import { chainSocksPort } from './chain.ports.js';
import { readChainSecret } from '../nodes/chain-secret.js';

/**
 * К6: what one push carries once the chain is its own process.
 *
 * The whole file is about ONE decision and its consequences. For a release the
 * panel sends both blocks, because a fleet updates one node at a time:
 *
 *   - `cascade` is what an agent too old to know `chain` applies, so it has to
 *     stay the legacy drawing, legs dialled across the internet and all;
 *   - `chain` carries the handover drawing for the user's core inside it,
 *     because an agent that knows the block ignores `cascade` entirely.
 *
 * Swap the two and an old agent configures its xray to hand traffic to a
 * loopback port nothing on that machine is listening on, which is every user
 * behind that entry. Leave the handover out of `chain` and a new agent has
 * nothing to give its core, and an entry with no cascade routing does not fail:
 * it sends users out of the ENTRY country while their client shows the exit
 * they picked.
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

/** One entry, two directions: the shape of the stand. */
async function makeCascade(entry: string, exits: string[], auto = false) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      autoProfile: auto,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' }],
      directions: exits.map((nodeId, i) => ({
        tag: i + 1,
        countryCode: i === 0 ? 'NL' : 'SE',
        nodeIds: [nodeId],
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

describe('the chain block in a push', () => {
  it('gives the entry a chain, its ports and the password its core will present', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const chain = await getChainForNode(entry);
    expect(chain).not.toBeNull();
    expect(chain!.engine).toBe('singbox');
    // One listener per way out, at the derived port. Two directions, no Auto.
    expect(chain!.socks).toEqual([
      { tag: 1, port: chainSocksPort(1) },
      { tag: 2, port: chainSocksPort(2) },
    ]);
    // The password is the node's, minted by this render and readable for
    // acceptance. Both halves of the handover must present the same one.
    expect(chain!.socksPassword).toBe(await readChainSecret(entry));
    expect(chain!.socksPassword.length).toBeGreaterThan(20);
  });

  it('sends the handover drawing in the chain and the legacy one in cascade', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const chain = await getChainForNode(entry);
    const legacy = await getCascadeFragmentsForNode(entry);

    // The chain's copy hands traffic to loopback.
    const handover = JSON.stringify(chain!.userCore!.fragments);
    expect(chain!.userCore!.engine).toBe('xray');
    expect(handover).toContain('"protocol":"socks"');
    expect(handover).toContain('127.0.0.1');
    expect(handover).toContain(String(chainSocksPort(1)));
    expect(handover).not.toContain('"protocol":"vless"');

    // ⚠ And the old block still dials the legs itself. This is the assertion
    // that keeps a half-updated fleet serving: an agent that cannot see the
    // chain block applies THIS, and a socks outbound here would point it at a
    // process that does not exist on its machine.
    const old = JSON.stringify(legacy);
    expect(old).toContain('"protocol":"vless"');
    expect(old).not.toContain('"protocol":"socks"');
    expect(old).not.toContain(chain!.socksPassword);
  });

  it('offers the Auto line as one more loopback port when the cascade has one', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se], true);

    const chain = await getChainForNode(entry);
    // Tag 0 first, because Auto is a way out like the others as far as the
    // handover is concerned: the choosing happens inside the chain process.
    expect(chain!.socks[0]).toEqual({ tag: 0, port: chainSocksPort(0) });
    const config = chain!.config as { outbounds: { type: string; tag: string }[] };
    expect(config.outbounds.some((o) => o.type === 'urltest' && o.tag === 'out-d0')).toBe(true);
  });

  it('gives an exit a chain with nothing to hand over', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const chain = await getChainForNode(nl);
    expect(chain).not.toBeNull();
    // No socks listeners: an exit receives on a link and egresses, it has no
    // user core to take traffic from.
    expect(chain!.socks).toEqual([]);
    const config = chain!.config as { inbounds: { tag: string }[] };
    expect(config.inbounds.map((i) => i.tag)).toEqual(['link-in']);
    // ⚠ And NO drawing for its user core, which is not an omission but the
    // point: the chain process listens on the link port here. Handing xray the
    // old fragments as well would put two processes on one port, and whichever
    // loses the bind takes the leg into this node down.
    expect(chain!.userCore).toBeUndefined();
  });

  it('gives a node outside every cascade no chain at all', async () => {
    // The state of the whole fleet, and the one a panel must never read as "the
    // chain is down": most nodes simply have none.
    const lonely = await makeNode('lonely');
    expect(await getChainForNode(lonely)).toBeNull();
  });

  it('leaves nothing behind when the cascade is switched off', async () => {
    // The rollback path, from the cascade's side rather than the panel's: a
    // disabled cascade stops producing both drawings, so the next push carries
    // neither block and the agent puts its core back the way it was.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const cascade = await makeCascade(entry, [nl, se]);

    expect(await getChainForNode(entry)).not.toBeNull();
    await prisma.cascade.update({ where: { id: cascade.id }, data: { enabled: false } });
    expect(await getChainForNode(entry)).toBeNull();
    expect(await getCascadeFragmentsForNode(entry)).toBeNull();

    // The secret stays: it belongs to the NODE, and minting a new one the next
    // time the cascade is switched back on would leave the node's core and its
    // chain process holding two different passwords for one handover.
    expect(await readChainSecret(entry)).not.toBeNull();
  });
});
