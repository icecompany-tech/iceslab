import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { getCascadeFragmentsForNode, getChainForNode } from './cascade.service.js';
import { chainSocksPort } from './chain.ports.js';

/**
 * Phase 10 (2): a cascade direction that goes out through a named outbound.
 *
 * The save (exactly one of a pool and an outbound, the outbound drawable by
 * the last position), and what the nodes are then told: the last position's
 * chain dials the outbound as `out-d<tag>`, the entry hands that direction to
 * its chain like any other. The chain's own shape is held by
 * chain.foreign.test.ts, with the engine asked and a request sent through.
 */
let app: FastifyInstance;
let token: string;
let seq = 0;

const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

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
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: auth(), ...(payload ? { payload } : {}) });

const VLESS_REALITY = {
  server: 'ch.example.net',
  port: 443,
  uuid: '6e1e9f7e-3f0b-4a55-9d6e-0f3e9a1c2b7d',
  flow: 'xtls-rprx-vision',
  security: 'reality',
  sni: 'www.apple.com',
  fingerprint: 'firefox',
  realityPublicKey: 'p'.repeat(43),
  realityShortId: '0123abcd',
};
const SOCKS = { server: '203.0.113.7', port: 1080, username: 'op', password: 'chain-socks-fixture-password-0000' };

/** A node, optionally with the engines it reported. */
async function makeNode(name: string, engines?: string[]): Promise<string> {
  seq += 1;
  const res = await req('POST', '/api/nodes', { name, address: `${name}-${seq}.test`, protocol: 'xray' });
  expect(res.statusCode, res.body).toBe(201);
  const id = JSON.parse(res.body).id as string;
  if (engines) {
    await prisma.node.update({
      where: { id },
      data: {
        cores: {
          observedAt: new Date().toISOString(),
          cores: engines.map((engine) => ({ name: engine, engine, running: true })),
        } as unknown as object,
      },
    });
  }
  return id;
}

async function makeOutbound(name: string, type: string, config: object = {}): Promise<string> {
  const res = await req('POST', '/api/named-outbounds', { name, type, config });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const entryPos = (nodeIds: string[]) => ({ position: 0, nodeIds, entryProtocol: 'xray', linkProtocol: 'vless' });

async function create(payload: object) {
  seq += 1;
  const res = await req('POST', '/api/cascades', { name: `c-${seq}`, enabled: true, ...payload });
  return { res, body: JSON.parse(res.body) };
}

describe('saving a direction on a named outbound', () => {
  it('stores the outbound in place of a pool, with no leg, no link and no port', async () => {
    const ru = await makeNode('ru');
    const nl = await makeNode('nl');
    const ch = await makeOutbound('ch', 'vless', VLESS_REALITY);
    const { res, body } = await create({
      positions: [entryPos([ru])],
      directions: [
        { countryCode: 'NL', nodeIds: [nl] },
        // A leg cell sent anyway, as a screen that switched the direction over
        // would still carry it: nothing of a leg is written for an outbound.
        { countryCode: 'CH', outboundId: ch, linkProtocol: 'hy2' },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const [d1, d2] = body.directions;
    expect(d1).toMatchObject({ tag: 1, nodeIds: [nl], outboundId: null, linkPort: 24000 });
    expect(d2).toMatchObject({ tag: 2, nodeIds: [], outboundId: ch, linkProtocol: null, linkParams: null, linkPort: null });
    const links = await prisma.cascadeLink.findMany({ where: { cascadeId: body.id } });
    expect(links.map((l) => [l.toNodeId, l.directionTag])).toEqual([[nl, 1]]);

    // And the outbound knows who stands on it, through a real save now.
    const got = JSON.parse((await req('GET', `/api/named-outbounds/${ch}`)).body);
    expect(got.usedBy).toEqual([{ cascadeId: body.id, cascadeName: body.name, directionTag: 2 }]);
    expect((await req('DELETE', `/api/named-outbounds/${ch}`)).statusCode).toBe(409);
  });

  it('refuses a direction with both, and one with neither, naming it', async () => {
    const ru = await makeNode('ru');
    const nl = await makeNode('nl');
    const ch = await makeOutbound('ch', 'socks', SOCKS);

    const both = await create({ positions: [entryPos([ru])], directions: [{ nodeIds: [nl], outboundId: ch }] });
    expect(both.res.statusCode, both.res.body).toBe(400);
    expect(both.body).toMatchObject({ error: 'DIRECTION_OUTBOUND_AND_NODES', directionIndex: 0, directionTag: null });

    const neither = await create({ positions: [entryPos([ru])], directions: [{ countryCode: 'NL', nodeIds: [nl] }, { countryCode: 'DE' }] });
    expect(neither.res.statusCode, neither.res.body).toBe(400);
    expect(neither.body).toMatchObject({ error: 'DIRECTION_EMPTY', directionIndex: 1, directionTag: null });
  });

  it('refuses an outbound that is not there, one of a type no direction takes, and one outbound twice', async () => {
    const ru = await makeNode('ru');
    const missing = '11111111-1111-4111-8111-111111111111';
    const r1 = await create({ positions: [entryPos([ru])], directions: [{ outboundId: missing }] });
    expect(r1.res.statusCode, r1.res.body).toBe(400);
    expect(r1.body).toMatchObject({ error: 'NAMED_OUTBOUND_NOT_FOUND', outboundId: missing });

    const free = await makeOutbound('local', 'freedom');
    const r2 = await create({ positions: [entryPos([ru])], directions: [{ outboundId: free }] });
    expect(r2.res.statusCode, r2.res.body).toBe(409);
    expect(r2.body).toMatchObject({ error: 'NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION', type: 'freedom' });

    const ch = await makeOutbound('ch', 'socks', SOCKS);
    const r3 = await create({ positions: [entryPos([ru])], directions: [{ outboundId: ch }, { outboundId: ch }] });
    expect(r3.res.statusCode, r3.res.body).toBe(400);
    expect(r3.body.error).toBe('INVALID');
  });

  it('refuses when the last position reports it cannot run the chain, and only then', async () => {
    // The entry is xray-only and that is fine: it is not the one drawing the
    // outbound. The transit on the last position is.
    const ru = await makeNode('ru', ['xray']);
    const de = await makeNode('de', ['xray']);
    const ch = await makeOutbound('ch', 'socks', SOCKS);
    const payload = {
      positions: [entryPos([ru]), { position: 1, nodeIds: [de], linkProtocol: 'vless' }],
      directions: [{ outboundId: ch }],
    };
    const refused = await create(payload);
    expect(refused.res.statusCode, refused.res.body).toBe(409);
    expect(refused.body).toMatchObject({
      error: 'NAMED_OUTBOUND_NEEDS_CHAIN',
      conflicts: [{ nodeName: 'de', engines: ['xray'] }],
    });

    await prisma.node.update({
      where: { id: de },
      data: { cores: { observedAt: 'now', cores: [{ name: 'xray', engine: 'xray' }, { name: 'xray', engine: 'singbox' }] } as unknown as object },
    });
    const ok = await create(payload);
    expect(ok.res.statusCode, ok.res.body).toBe(201);
  });

  it('keeps the tag across a save that sends no id, and moves a direction between an outbound and a pool', async () => {
    const ru = await makeNode('ru');
    const nl = await makeNode('nl');
    const ch = await makeOutbound('ch', 'socks', SOCKS);
    const { body } = await create({
      positions: [entryPos([ru])],
      directions: [{ countryCode: 'NL', nodeIds: [nl] }, { countryCode: 'CH', outboundId: ch }],
    });
    const put = (payload: object) => req('PUT', `/api/cascades/${body.id}`, { positions: [entryPos([ru])], ...payload });

    // No ids at all: the pool finds tag 1, the outbound finds tag 2.
    const same = await put({ directions: [{ nodeIds: [nl] }, { outboundId: ch }] });
    expect(same.statusCode, same.body).toBe(200);
    expect(JSON.parse(same.body).directions.map((d: { tag: number; outboundId: string | null }) => [d.tag, d.outboundId])).toEqual([
      [1, null],
      [2, ch],
    ]);

    // The pool beside a stored outbound, without saying the outbound goes:
    // refused, not guessed.
    const d2 = JSON.parse(same.body).directions[1].id as string;
    const nl2 = await makeNode('nl-2');
    const half = await put({ directions: [{ nodeIds: [nl] }, { id: d2, nodeIds: [nl2] }] });
    expect(half.statusCode, half.body).toBe(400);
    expect(JSON.parse(half.body)).toMatchObject({ error: 'DIRECTION_OUTBOUND_AND_NODES', directionTag: 2 });

    const moved = await put({ directions: [{ nodeIds: [nl] }, { id: d2, nodeIds: [nl2], outboundId: null }] });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(JSON.parse(moved.body).directions[1]).toMatchObject({ tag: 2, nodeIds: [nl2], outboundId: null, linkPort: 24000 });
  });
});

describe('what the nodes are told', () => {
  it('an entry on the last position dials the outbound itself, and hands that direction to its chain', async () => {
    const ru = await makeNode('ru');
    const nl = await makeNode('nl');
    const ch = await makeOutbound('ch', 'vless', VLESS_REALITY);
    const ge = await makeOutbound('ge', 'socks', SOCKS);
    await create({
      autoProfile: true,
      positions: [entryPos([ru])],
      directions: [{ nodeIds: [nl] }, { outboundId: ch }, { outboundId: ge }],
    });

    const chain = await getChainForNode(ru);
    const cfg = chain!.config as { outbounds: Record<string, unknown>[] };
    const by = new Map(cfg.outbounds.map((o) => [o.tag as string, o]));
    expect(by.get('out-d1')!.server).toBe('nl-2.test');
    expect(by.get('out-d2')).toMatchObject({ type: 'vless', server: 'ch.example.net', server_port: 443 });
    expect(by.get('out-d3')).toMatchObject({ type: 'socks', server: '203.0.113.7', username: 'op' });
    expect(by.get('out-d0')!.outbounds).toEqual(['out-d1', 'out-d2', 'out-d3']);
    expect(chain!.socks.map((s) => s.tag)).toEqual([0, 1, 2, 3]);

    // The xray entry hands directions 2 and 3 to the chain like direction 1.
    const handover = (chain!.userCore as { fragments: { outbounds: { tag: string; settings: { servers: { port: number }[] } }[] } })
      .fragments.outbounds;
    for (const tag of [1, 2, 3]) {
      const o = handover.find((x) => x.tag === `cascade-link-out-chain-d${tag}`);
      expect(o?.settings.servers[0]!.port, `direction ${tag}`).toBe(chainSocksPort(tag));
    }
  });

  it('a cascade whose only ways out are outbounds is found by its entry, which has no link at all', async () => {
    const ru = await makeNode('ru');
    const ge = await makeOutbound('ge', 'socks', SOCKS);
    const { body } = await create({ positions: [entryPos([ru])], directions: [{ outboundId: ge }] });
    expect(await prisma.cascadeLink.count({ where: { cascadeId: body.id } })).toBe(0);

    const chain = await getChainForNode(ru);
    expect(chain).not.toBeNull();
    const cfg = chain!.config as { outbounds: Record<string, unknown>[] };
    expect(cfg.outbounds.find((o) => o.tag === 'out-d1')).toMatchObject({ type: 'socks', server: '203.0.113.7' });
    // The legacy xray drawing has nothing to offer such a node, by design.
    expect(await getCascadeFragmentsForNode(ru)).toBeNull();

    if (SINGBOX_BIN) {
      const dir = mkdtempSync(join(tmpdir(), 'iceslab-no-'));
      const file = join(dir, 'config.json');
      writeFileSync(file, JSON.stringify(chain!.config));
      execFileSync(SINGBOX_BIN, ['check', '-c', file]);
    }
  });

  it('a transit on the last position dials it, and the entry reaches it over the leg of its direction', async () => {
    const ru = await makeNode('ru');
    const de = await makeNode('de');
    const nl = await makeNode('nl');
    const ch = await makeOutbound('ch', 'socks', SOCKS);
    await create({
      positions: [entryPos([ru]), { position: 1, nodeIds: [de], linkProtocol: 'vless' }],
      directions: [{ nodeIds: [nl] }, { outboundId: ch }],
    });

    const entry = await getChainForNode(ru);
    const entryOut = (entry!.config as { outbounds: { tag: string; server?: string }[] }).outbounds;
    expect(entryOut.filter((o) => /^out-d\d$/.test(o.tag)).map((o) => [o.tag, o.server])).toEqual([
      ['out-d1', 'de-2.test'],
      ['out-d2', 'de-2.test'],
    ]);

    const transit = await getChainForNode(de);
    const cfg = transit!.config as { outbounds: Record<string, unknown>[]; route: { rules: Record<string, unknown>[] } };
    expect(cfg.outbounds.find((o) => o.tag === 'out-d2')).toMatchObject({ type: 'socks', server: '203.0.113.7' });
    expect(cfg.route.rules.filter((r) => Array.isArray(r.auth_user)).map((r) => [(r.auth_user as string[])[0], r.outbound])).toEqual([
      ['lnk-d1', 'out-d1'],
      ['lnk-d2', 'out-d2'],
    ]);
    // The exit behind direction 1 is untouched by the outbound beside it.
    expect(await getChainForNode(nl)).not.toBeNull();
  });
});
