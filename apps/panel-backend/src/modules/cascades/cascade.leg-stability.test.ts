import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { getCascadeFragmentsForNode } from './cascade.service.js';

/**
 * A leg keeps its secrets, and its REALITY block reaches the node.
 *
 * Two faults, one cause: the credential of a leg lived only as long as the save
 * that minted it.
 *
 *   - `serializeLinkCred` dropped the REALITY block, and every renderer rebuilds
 *     its creds from the column. So the hardening added in 2026-08, which makes
 *     an inter-hop leg look like a TLS handshake to a large site, had never
 *     reached a node: the legs ran plain VLESS over raw TCP on a high port. The
 *     tests of the day did not see it because they build fragments from the
 *     in-memory cred, where the block is present;
 *
 *   - and the link rows are replaced wholesale on every save, so every save
 *     minted every secret again. Renaming a direction rotated the keys of a leg
 *     carrying live traffic, and because the two ends are pushed one after the
 *     other, the chain spent the gap as a pair that no longer agreed.
 *
 * What the tests below pin is therefore not a refactor: it is that a save is
 * boring. The same cascade saved twice is byte for byte the same credentials.
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
    payload: { name, address: `leg-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** The stored creds of every leg, ordered so two reads compare. */
async function storedCreds() {
  const rows = await prisma.cascadeLink.findMany({
    orderBy: [{ toNodeId: 'asc' }, { directionTag: 'asc' }],
    select: { toNodeId: true, directionTag: true, config: true },
  });
  return rows.map((r) => r.config);
}

async function create(entry: string, exits: string[], cells: string[] = []) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [
        { position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' },
      ],
      directions: exits.map((nodeId, i) => ({
        countryCode: i === 0 ? 'NL' : 'SE',
        nodeIds: [nodeId],
        ...(cells[i] ? { linkProtocol: cells[i] } : {}),
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

async function put(c: { id: string; positions: unknown[]; directions: { id: string }[] }, entry: string, directions: unknown[]) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cascades/${c.id}`,
    headers: auth(),
    payload: {
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body);
}

describe('a leg across two saves', () => {
  it('keeps every secret, byte for byte', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const se = await makeNode('se-exit');
    const c = await create(entry, [nl, se], ['tuic', 'shadowsocks']);

    const before = await storedCreds();
    expect(before).toHaveLength(2);

    await put(c, entry, [
      { id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl], linkProtocol: 'tuic' },
      { id: c.directions[1].id, countryCode: 'SE', nodeIds: [se], linkProtocol: 'shadowsocks' },
    ]);

    // Not "looks the same": the same values. A uuid, a PSK, a private key and a
    // certificate are what the other end of the leg is holding.
    expect(await storedCreds()).toEqual(before);
  });

  it('keeps them through an edit that has nothing to do with the leg', async () => {
    // The realistic way keys used to rotate: renaming a direction's country.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await create(entry, [nl]);

    const before = await storedCreds();
    await put(c, entry, [{ id: c.directions[0].id, countryCode: 'DE', nodeIds: [nl] }]);
    expect(await storedCreds()).toEqual(before);
  });

  it('mints fresh ones when the cell changes, because the old secret describes another protocol', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await create(entry, [nl]);
    const before = (await storedCreds())[0] as { protocol: string; uuid: string };
    expect(before.protocol).toBe('vless');

    await put(c, entry, [
      { id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl], linkProtocol: 'shadowsocks' },
    ]);
    const after = (await storedCreds())[0] as { protocol: string; psk: string };
    expect(after.protocol).toBe('shadowsocks');
    expect(after.psk).toBeTypeOf('string');
  });

  it('takes a new knob without touching the secrets under it', async () => {
    // A congestion controller is a preference, not a credential: changing it
    // must take effect, and must not rotate the uuid and the certificate.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await create(entry, [nl], ['tuic']);
    const before = (await storedCreds())[0] as { uuid: string; password: string; congestion: string; tls: unknown };
    expect(before.congestion).toBe('bbr');

    await put(c, entry, [
      {
        id: c.directions[0].id,
        countryCode: 'NL',
        nodeIds: [nl],
        linkProtocol: 'tuic',
        linkParams: { congestion: 'cubic' },
      },
    ]);
    const after = (await storedCreds())[0] as { uuid: string; password: string; congestion: string; tls: unknown };
    expect(after.congestion).toBe('cubic');
    expect(after.uuid).toBe(before.uuid);
    expect(after.password).toBe(before.password);
    expect(after.tls).toEqual(before.tls);
  });
});

describe('the REALITY block of a vless leg', () => {
  /**
   * ⚠ Shipped in TWO commits, in this order, and the order is the whole story.
   *
   * First both renderers learned the shape (one keypair per receiving node,
   * short ids as a list, VISION named by both ends or by neither), which
   * changed nothing in the field because no credential had a block. Only then
   * did the block start being stored, which is the release that actually
   * switches the legs over.
   *
   * The other order would have broken every v4 cascade on its next save: the
   * dialling side switches itself on per credential, so a stored block with a
   * listener that could not answer is a pair that loads cleanly and completes
   * no handshake.
   *
   * The tests below check the two ends AGAINST EACH OTHER, built from the same
   * stored credential. Two green `sing-box check` runs would not have caught
   * the 2026-08 fault and would not catch a short id the listener does not
   * list, because each config is perfectly valid on its own.
   */
  it('is stored whole, and the listener it belongs to is no longer plain', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    await create(entry, [nl]);

    const cred = (await storedCreds())[0] as {
      reality?: { privateKey: string; publicKey: string; shortId: string; serverName: string; dest: string };
    };
    expect(cred.reality, 'the block did not reach the column').toBeDefined();
    for (const key of ['privateKey', 'publicKey', 'shortId', 'serverName', 'dest'] as const) {
      expect(cred.reality![key], `${key} is missing`).toBeTypeOf('string');
      expect(cred.reality![key].length).toBeGreaterThan(0);
    }

    // And the fragments a push carries, built from that column: this is the
    // assertion that would have caught 2026-08 on the day.
    const fragments = await getCascadeFragmentsForNode(nl);
    expect(fragments).not.toBeNull();
    const inbound = fragments!.inbounds.find((i) =>
      (i as { tag?: string }).tag?.includes('link-in'),
    ) as {
      settings: { clients: { flow?: string }[] };
      streamSettings: { security?: string; realitySettings?: { shortIds: string[] } };
    };
    expect(inbound.streamSettings.security).toBe('reality');
    expect(inbound.streamSettings.realitySettings!.shortIds).toEqual([cred.reality!.shortId]);
    expect(inbound.settings.clients[0]!.flow).toBe('xtls-rprx-vision');
  });

  it('is given to a leg stored without one exactly once', async () => {
    /**
     * The rotation and its bound.
     *
     * Every leg stored before 5b has no block. The first save after the deploy
     * gives it one, which does rotate that leg's handshake once and is counted
     * in the panel's log. The second save must change nothing at all, or
     * "rotates once" is only "rotates later".
     */
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await create(entry, [nl]);

    // The shape a pre-5b row has: the cred with its block taken out.
    const row = await prisma.cascadeLink.findFirstOrThrow({ select: { id: true, config: true } });
    const { reality: _gone, ...withoutBlock } = row.config as Record<string, unknown>;
    await prisma.cascadeLink.update({ where: { id: row.id }, data: { config: withoutBlock } });

    await put(c, entry, [{ id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl] }]);
    const rotated = (await storedCreds())[0] as { reality?: { publicKey: string } };
    expect(rotated.reality, 'the leg was not given a block').toBeDefined();

    await put(c, entry, [{ id: c.directions[0].id, countryCode: 'NL', nodeIds: [nl] }]);
    expect(await storedCreds()).toEqual([rotated]);
  });

  it('gives every leg landing on one node the same key and its own short id', async () => {
    /**
     * The shape the engine forces: one listener, one `private_key`, a LIST of
     * short ids. Two directions reaching one node would otherwise carry two
     * private keys with nowhere to put the second.
     *
     * Two directions on ONE node is refused (each reaches its nodes over its
     * own leg), so the shape that exercises this is a POOL on the entry: two
     * entry nodes both dialling the same exit, which is two legs landing on one
     * listener.
     */
    const entryA = await makeNode('ru-entry-a');
    const entryB = await makeNode('ru-entry-b');
    const nl = await makeNode('nl-exit');

    seq += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: {
        name: `ru-out-${seq}`,
        enabled: true,
        positions: [
          { position: 0, nodeIds: [entryA, entryB], entryProtocol: 'xray', linkProtocol: 'vless' },
        ],
        directions: [{ countryCode: 'NL', nodeIds: [nl] }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);

    const legs = (await storedCreds()) as {
      reality: { privateKey: string; publicKey: string; shortId: string };
    }[];
    expect(legs).toHaveLength(2);
    expect(legs[0]!.reality.privateKey).toBe(legs[1]!.reality.privateKey);
    expect(legs[0]!.reality.publicKey).toBe(legs[1]!.reality.publicKey);
    // Own short id per leg, or the listener could not tell the two apart.
    expect(legs[0]!.reality.shortId).not.toBe(legs[1]!.reality.shortId);

    // And the listener lists both, which is what the engine reads.
    const fragments = await getCascadeFragmentsForNode(nl);
    const inbound = fragments!.inbounds.find((i) =>
      (i as { tag?: string }).tag?.includes('link-in'),
    ) as { streamSettings: { realitySettings?: { shortIds: string[]; privateKey: string } } };
    expect(inbound.streamSettings.realitySettings!.shortIds.sort()).toEqual(
      legs.map((l) => l.reality.shortId).sort(),
    );
    expect(inbound.streamSettings.realitySettings!.privateKey).toBe(legs[0]!.reality.privateKey);
  });

  it('makes both ends agree on a block somebody put in the column by hand', async () => {
    // The cross-check, at the level a push actually works at: both ends built
    // from the same STORED credential. Two green `sing-box check` runs would
    // not have caught 2026-08 and would not catch a short id the listener does
    // not list, because each config is valid on its own.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await create(entry, [nl]);

    const row = await prisma.cascadeLink.findFirstOrThrow({ select: { id: true, config: true } });
    await prisma.cascadeLink.update({
      where: { id: row.id },
      data: {
        config: {
          ...(row.config as Record<string, unknown>),
          reality: {
            privateKey: 'k'.repeat(43),
            publicKey: 'p'.repeat(43),
            shortId: '0123abcd',
            serverName: 'www.example.com',
            dest: 'www.example.com:443',
          },
        },
      },
    });

    const fragments = await getCascadeFragmentsForNode(entry);
    const outbound = fragments!.outbounds.find(
      (o) => (o as { protocol?: string }).protocol === 'vless',
    ) as {
      settings: { vnext: { users: { flow?: string }[] }[] };
      streamSettings: {
        security?: string;
        realitySettings?: { publicKey: string; shortId: string; serverName: string; fingerprint: string };
      };
    };
    const exitFragments = await getCascadeFragmentsForNode(nl);
    const inbound = exitFragments!.inbounds.find((i) =>
      (i as { tag?: string }).tag?.includes('link-in'),
    ) as {
      settings: { clients: { flow?: string }[] };
      streamSettings: {
        security?: string;
        realitySettings?: { privateKey: string; shortIds: string[]; serverNames: string[]; dest: string };
      };
    };

    expect(outbound.streamSettings.security).toBe('reality');
    expect(inbound.streamSettings.security).toBe('reality');
    // The dialler's short id is one the listener lists, the camouflage name is
    // the same on both, and the two halves of the keypair come from the one
    // stored block. Any of the three drifting is a leg that loads and refuses
    // every packet.
    expect(inbound.streamSettings.realitySettings!.shortIds).toContain(
      outbound.streamSettings.realitySettings!.shortId,
    );
    expect(inbound.streamSettings.realitySettings!.serverNames).toContain(
      outbound.streamSettings.realitySettings!.serverName,
    );
    expect(inbound.streamSettings.realitySettings!.privateKey).toBe('k'.repeat(43));
    expect(outbound.streamSettings.realitySettings!.publicKey).toBe('p'.repeat(43));
    // VISION is per user and is named by both or by neither.
    expect(inbound.settings.clients[0]!.flow).toBe('xtls-rprx-vision');
    expect(c.id).toBeTruthy();
  });
});
