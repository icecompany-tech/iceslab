import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { LINK_PORT_BASE } from './cascade.config.js';

/**
 * A cascade leg and a profile can claim the same port, and nothing stopped them.
 *
 * The uniqueness key guards bindings against bindings and cannot reach
 * `cascade_links`: no index spans two tables. So a profile bound to 24000 saved
 * cleanly, the node then failed to bring one of the two listeners up, and the
 * only trace was a line in the agent's journal hours later.
 *
 * Both directions are tested because both are real: whichever of the two is
 * saved second has to ask about the first. A test for one direction only would
 * leave the other exactly as silent as it was.
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

async function makeNode(name: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address: `link-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function makeProfile(name: string, protocol = 'xray', config: unknown = XRAY_CONFIG) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name, protocol, config },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function bind(profileId: string, nodeId: string, port: number, expected = 201) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

/** One entry, two directions: the shape that folds to a balancer and draws
 *  legs onto both exit nodes at LINK_PORT_BASE.
 *
 *  `cells` names the cell of the leg into each direction, phase 5. Left out,
 *  every direction is reached over the entry's cell, which is what every
 *  cascade did before directions could choose. */
async function makeCascade(entry: string, exits: string[], expected = 201, cells: string[] = []) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [
        // `xray` and not `vless`: the API schema takes protocol names, and the
        // link-cell dictionary maps that one onto the vless cell.
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
      directions: exits.map((nodeId, i) => ({
        tag: i + 1,
        countryCode: i === 0 ? 'NL' : 'SE',
        nodeIds: [nodeId],
        ...(cells[i] ? { linkProtocol: cells[i] } : {}),
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

describe('a cascade leg and a profile on one port', () => {
  it('stores the link port in its own column, not only inside the cred', async () => {
    // The column is what makes the question cheap; if it silently stopped being
    // written, every check below would pass by reading the legacy path alone.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const links = await prisma.cascadeLink.findMany({
      select: { port: true, config: true, toNodeId: true },
    });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.port).toBe((l.config as { port: number }).port);
      expect(l.port).toBe(LINK_PORT_BASE);
    }
  });

  it('refuses a profile bound onto a port a cascade already listens on', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const profile = await makeProfile('reality-nl');
    const refused = await bind(profile, nl, LINK_PORT_BASE, 409);

    expect(refused.message).toContain('24000');
    expect(refused.message).toContain('nl-exit');
    // Naming the cascade is the point: there is no other PROFILE to go and
    // look at, and an operator told only "port in use" would hunt for one.
    expect(refused.message).toContain('ru-out');
  });

  it('lets a UDP profile have that port, because it is a different socket', async () => {
    // Link cells ride xray over TCP. Refusing Hysteria2 here would be the same
    // untruth the transport key was added to stop telling.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const hy = await makeProfile('hy2-nl', 'hysteria', {});
    await bind(hy, nl, LINK_PORT_BASE);
  });

  it('refuses a cascade whose legs land on a port a profile already holds', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');

    const profile = await makeProfile('reality-nl');
    await bind(profile, nl, LINK_PORT_BASE);

    const refused = await makeCascade(entry, [nl, se], 409);
    expect(refused.error).toBe('LINK_PORT_IN_USE');
    expect(refused.conflicts).toEqual([
      // The transport travels with the conflict since phase 5: the screen has
      // to say which of the two sockets on 24000 is the taken one.
      { nodeName: 'nl-exit', port: LINK_PORT_BASE, transport: 'tcp', profileName: 'reality-nl' },
    ]);
    // Nothing half-written: a refused save must not leave a cascade behind.
    expect(await prisma.cascade.count()).toBe(0);
  });

  it('names every blocked leg, not the first one', async () => {
    // A cascade is saved whole. One refusal per leg would walk the operator
    // through as many saves as it has exits, each looking like a new problem.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');

    await bind(await makeProfile('reality-nl'), nl, LINK_PORT_BASE);
    await bind(await makeProfile('reality-se'), se, LINK_PORT_BASE);

    const refused = await makeCascade(entry, [nl, se], 409);
    expect(refused.conflicts).toHaveLength(2);
    expect(refused.conflicts.map((c: { nodeName: string }) => c.nodeName).sort()).toEqual([
      'nl-exit',
      'se-exit',
    ]);
  });

  it('still refuses when the cascade exists only in the legacy hop storage', async () => {
    // cascade_links is a shadow-write of the v4 topology. A cascade saved
    // before it existed, or one whose shape does not fold, keeps its ports only
    // inside CascadeHop.linkConfig, and reading the indexed column alone would
    // answer "free" for a port that is taken. A partial list is enough to say
    // yes and useless for saying no.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    await prisma.cascadeLink.deleteMany({});
    expect(await prisma.cascadeLink.count()).toBe(0);
    expect(await prisma.cascadeHop.count()).toBeGreaterThan(0);

    const profile = await makeProfile('reality-nl');
    const refused = await bind(profile, nl, LINK_PORT_BASE, 409);
    expect(refused.message).toContain('ru-out');
  });

  it('says nothing about ports no cascade touches', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    await bind(await makeProfile('reality-443'), nl, 443);
    await bind(await makeProfile('reality-far'), se, LINK_PORT_BASE + 50);
  });

  /**
   * Phase 5: a leg is not always TCP any more.
   *
   * Everything above was written when both cells rode the node's xray over TCP,
   * and the transport was a constant in three places: the port owner, the
   * refusal message and the filter that compares a leg against a profile. Two
   * of the four cells are QUIC now, and a constant `tcp` is not a simplification
   * once that is true, it is a wrong answer in both directions at once. It
   * refuses a TCP profile that can legally share the number with a tuic leg,
   * and it promises a UDP profile the very socket that leg holds.
   */
  describe('a QUIC leg', () => {
    it('holds the port on UDP, and says so where an operator reads it', async () => {
      const entry = await makeNode('ru-entry');
      const nl = await makeNode('nl-exit');
      const se = await makeNode('se-exit');
      await makeCascade(entry, [nl, se], 201, ['tuic', 'tuic']);

      const check = async (transport: string) => {
        const res = await app.inject({
          method: 'POST',
          url: `/api/nodes/${nl}/port-check`,
          headers: auth(),
          payload: { port: LINK_PORT_BASE, transport },
        });
        expect(res.statusCode, res.body).toBe(200);
        return JSON.parse(res.body);
      };

      const udp = await check('udp');
      expect(udp.ok).toBe(false);
      expect(udp.conflicts).toHaveLength(1);
      expect(udp.conflicts[0]).toMatchObject({ kind: 'cascade', transport: 'udp' });
      // And the same number on TCP is free, which is the half a constant would
      // have got wrong quietly: the operator would have been refused a port
      // nothing holds.
      const tcp = await check('tcp');
      expect(tcp.ok).toBe(true);
    });

    it('blocks a UDP profile on that port and leaves the TCP one alone', async () => {
      const entry = await makeNode('ru-entry');
      const nl = await makeNode('nl-exit');
      const se = await makeNode('se-exit');
      await makeCascade(entry, [nl, se], 201, ['tuic', 'tuic']);

      const hy = await makeProfile('hy2-nl', 'hysteria', {});
      const refused = await bind(hy, nl, LINK_PORT_BASE, 409);
      expect(refused.error).toBe('PORT_TAKEN_CASCADE');
      expect(refused.message).toContain('ru-out');

      // The mirror case, and the one this whole piece exists for: REALITY on
      // 24000/TCP beside a tuic leg on 24000/UDP is two listeners.
      await bind(await makeProfile('reality-nl'), nl, LINK_PORT_BASE);
    });

    it('is refused by a UDP profile that was there first, and not by a TCP one', async () => {
      const entry = await makeNode('ru-entry');
      const nl = await makeNode('nl-exit');
      const se = await makeNode('se-exit');

      await bind(await makeProfile('hy2-nl', 'hysteria', {}), nl, LINK_PORT_BASE);
      const refused = await makeCascade(entry, [nl, se], 409, ['tuic', 'tuic']);
      expect(refused.error).toBe('LINK_PORT_IN_USE');
      expect(refused.conflicts).toEqual([
        { nodeName: 'nl-exit', port: LINK_PORT_BASE, transport: 'udp', profileName: 'hy2-nl' },
      ]);
      // The transport is in the message too: "24000/TCP" about a tuic leg
      // sends the operator to look at the wrong listener.
      expect(refused.message).toContain('24000/UDP');
      expect(await prisma.cascade.count()).toBe(0);
    });

    it('does not refuse a vless leg over a UDP profile on the same number', async () => {
      // The same pair with the cell left alone. This one was refused before the
      // transport was read, and refusing it is refusing a legal configuration.
      const entry = await makeNode('ru-entry');
      const nl = await makeNode('nl-exit');
      const se = await makeNode('se-exit');

      await bind(await makeProfile('hy2-nl', 'hysteria', {}), nl, LINK_PORT_BASE);
      await makeCascade(entry, [nl, se]);
    });
  });

  it('counts the port the LEGACY storage assigns, which is not always the v4 one', async () => {
    /**
     * A finding, pinned here so it is not lost: for a balancer the two
     * storages disagree about the port of every exit after the first.
     *
     * v4 gives one port per receiving STEP (LINK_PORT_BASE + step), because a
     * pool of exits shares one inbound. The hop storage hands out one cred per
     * LINK, so exit k gets LINK_PORT_BASE + k. With two exits the second one is
     * 24000 in `cascade_links` and 24001 in its hop's `linkConfig`, and the
     * fragment builder reads the HOPS, so 24001 is what the node listens on.
     *
     * That is not this piece's to fix: changing it changes what deployed nodes
     * listen on. What it means here is that the union of both sources is the
     * only honest answer, and reading the tidy indexed column alone would have
     * left 24001 looking free while a node listens on it.
     */
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    await makeCascade(entry, [nl, se]);

    const hops = await prisma.cascadeHop.findMany({
      orderBy: { position: 'asc' },
      select: { position: true, linkConfig: true },
    });
    expect((hops[2]!.linkConfig as { port: number }).port).toBe(LINK_PORT_BASE + 1);
    expect(
      (await prisma.cascadeLink.findMany({ where: { toNodeId: se } })).map((l) => l.port),
    ).toEqual([LINK_PORT_BASE]);

    const refused = await bind(await makeProfile('reality-se'), se, LINK_PORT_BASE + 1, 409);
    expect(refused.message).toContain('24001');
  });
});
