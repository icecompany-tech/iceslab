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
   * ⚠ Half-shipped ON PURPOSE, and this is the half that is safe.
   *
   * The block is still not stored, so every leg in the field keeps running
   * plain VLESS exactly as it did. What changed with 5b's first commit is that
   * both RENDERERS now know the shape: the receiving step renders one
   * `privateKey` with every arriving short id beside it, and names the VISION
   * flow whenever the block is there.
   *
   * The order is deliberate. Storing the block first would have made the
   * dialling side ask for REALITY at a listener that could not answer, and the
   * cascade would have stopped carrying traffic on its next save. Renderer
   * first is invisible; storage second is the release that switches the legs
   * over, with both ends already able to speak.
   *
   * The first test below therefore still says "plain", because nothing stores
   * a block yet. The second one puts a block in the column by hand and is the
   * cross-check that 2026-08 never had: both ends built from the SAME stored
   * credential, compared with each other.
   */
  it('is not stored, so the leg still listens in plain', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    await create(entry, [nl]);

    expect((await storedCreds())[0]).not.toHaveProperty('reality');

    const fragments = await getCascadeFragmentsForNode(nl);
    expect(fragments).not.toBeNull();
    const inbound = fragments!.inbounds.find((i) =>
      (i as { tag?: string }).tag?.includes('link-in'),
    ) as {
      settings: { clients: { flow?: string }[] };
      streamSettings: { security?: string };
    };
    expect(inbound.streamSettings.security).toBe('none');
    expect(inbound.settings.clients[0]!.flow).toBeUndefined();
  });

  it('makes both ends agree the moment a block is in the column', async () => {
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
