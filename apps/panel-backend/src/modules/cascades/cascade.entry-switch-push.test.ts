import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { applyInboundsRequestForNode } from '../inbounds/inbounds.queue.js';
import { CHAIN_SOCKS_USER, chainSocksPort } from './chain.ports.js';

/**
 * What the PUSH carries when the entry moves from xray to hysteria, phase 6.
 *
 * The request is read the way the worker builds it, so this is what a node
 * would actually receive. "Before" is taken BEFORE the switch and serves as
 * the golden: a render retaken after the change could only ever agree with
 * itself.
 *
 * ⚠ The finding this file pins. The agent tells xray "not you" when the chain
 * block names hysteria, and for xray that does not mean "no cascade": it means
 * "read the transitional copy on your inbound". The panel used to attach that
 * copy whatever the entry protocol was, so on a hysteria entry xray would have
 * dialled the legacy legs ITSELF, beside the chain process, and kept its users
 * in the cascade. That contradicts what the operator confirmed on the switch
 * (their xray users leave straight from the entry country) and puts a second
 * process on one chain. The switch therefore removes exactly one thing from the
 * xray inbound, its cascade copy, and nothing else.
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

async function bindProfile(nodeId: string, name: string, protocol: string, config: unknown, port: number) {
  const p = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name, protocol, config },
  });
  expect(p.statusCode, p.body).toBe(201);
  const b = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId: JSON.parse(p.body).id, nodeId, port },
  });
  expect(b.statusCode, b.body).toBe(201);
}

function topology(entry: string, exit: string, entryProtocol: string) {
  return {
    positions: [{ position: 0, nodeIds: [entry], entryProtocol, linkProtocol: 'vless' }],
    directions: [{ countryCode: 'NL', nodeIds: [exit] }],
  };
}

interface Inbound {
  protocol: string;
  config: Record<string, unknown>;
}

const inboundOf = (req: { inbounds: unknown[] }, protocol: string) =>
  (req.inbounds as Inbound[]).find((i) => i.protocol === protocol)!;

describe('the push when the entry moves from xray to hysteria', () => {
  it('re-tells the entry where to hand its users, and takes the xray drawing away', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru', 'xray', XRAY_CONFIG, 443);
    await bindProfile(entry, 'hy2-ru', 'hysteria', {}, 8443);

    seq += 1;
    const created = await app.inject({
      method: 'POST',
      url: '/api/cascades',
      headers: auth(),
      payload: { name: `ru-out-${seq}`, enabled: true, ...topology(entry, exit, 'xray') },
    });
    expect(created.statusCode, created.body).toBe(201);
    const c = JSON.parse(created.body);

    const before = (await applyInboundsRequestForNode(entry))!;
    expect(before.chain?.userCore?.engine).toBe('xray');
    expect(before.cascade).toBeDefined();
    expect(inboundOf(before, 'xray').config).toHaveProperty('cascade');

    const switched = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${c.id}`,
      headers: auth(),
      payload: { ...topology(entry, exit, 'hysteria'), confirmEntryChange: true },
    });
    expect(switched.statusCode, switched.body).toBe(200);

    const after = (await applyInboundsRequestForNode(entry))!;

    // The hand-off: hysteria is told, and told a port, not an address.
    expect(after.chain?.userCore).toEqual({
      engine: 'hysteria',
      socks: { port: chainSocksPort(0), username: CHAIN_SOCKS_USER, password: after.chain!.socksPassword },
    });

    // No xray drawing of the cascade on this entry any more, in EITHER place a
    // node could read one from: the node-level block, and the transitional copy
    // on the xray inbound that xray falls back to when told "not you".
    expect(after.cascade).toBeUndefined();
    expect(inboundOf(after, 'xray').config).not.toHaveProperty('cascade');
  });

  it('leaves the xray inbound byte for byte what it was, less its cascade copy', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'reality-ru', 'xray', XRAY_CONFIG, 443);
    seq += 1;
    const c = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cascades',
          headers: auth(),
          payload: { name: `ru-out-${seq}`, enabled: true, ...topology(entry, exit, 'xray') },
        })
      ).body,
    );

    const before = inboundOf((await applyInboundsRequestForNode(entry))!, 'xray');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${c.id}`,
      headers: auth(),
      payload: { ...topology(entry, exit, 'hysteria'), confirmEntryChange: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = inboundOf((await applyInboundsRequestForNode(entry))!, 'xray');

    // The golden is the render taken BEFORE the switch, not one retaken after.
    const { cascade: _dropped, ...beforeWithoutCascade } = before.config;
    expect(JSON.stringify({ ...before, config: beforeWithoutCascade })).toBe(JSON.stringify(after));
  });

  it('leaves the hysteria inbound byte for byte what it was: the hand-off rides in the chain block', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await bindProfile(entry, 'hy2-ru', 'hysteria', {}, 8443);
    seq += 1;
    const c = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cascades',
          headers: auth(),
          payload: { name: `ru-out-${seq}`, enabled: true, ...topology(entry, exit, 'xray') },
        })
      ).body,
    );

    const before = inboundOf((await applyInboundsRequestForNode(entry))!, 'hysteria');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${c.id}`,
      headers: auth(),
      payload: topology(entry, exit, 'hysteria'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = inboundOf((await applyInboundsRequestForNode(entry))!, 'hysteria');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('does not touch the exit at all: the entry protocol is the entry\'s business', async () => {
    // Legs are reused across saves (phase 5.8a), so nothing on the far side of
    // the first leg has a reason to move. If it did, the switch would restart
    // cores on nodes that had nothing to do with it.
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    seq += 1;
    const c = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cascades',
          headers: auth(),
          payload: { name: `ru-out-${seq}`, enabled: true, ...topology(entry, exit, 'xray') },
        })
      ).body,
    );

    const before = await applyInboundsRequestForNode(exit);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cascades/${c.id}`,
      headers: auth(),
      payload: topology(entry, exit, 'hysteria'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = await applyInboundsRequestForNode(exit);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('warns about nothing: a hysteria entry with no xray drawing is the design, not a missing one', async () => {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    seq += 1;
    const c = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cascades',
          headers: auth(),
          payload: { name: `ru-out-${seq}`, enabled: true, ...topology(entry, exit, 'hysteria') },
        })
      ).body,
    );
    expect(c.id).toBeTruthy();

    const { getLogger } = await import('../../lib/infra/logger.js');
    const warnings: string[] = [];
    const logger = getLogger();
    const original = logger.warn.bind(logger);
    (logger as { warn: (m: unknown) => void }).warn = (m: unknown) => {
      warnings.push(String(m));
    };
    try {
      await applyInboundsRequestForNode(entry);
    } finally {
      (logger as { warn: typeof original }).warn = original;
    }
    // The "builds no fragments" line exists for a cascade that is broken. Firing
    // it on every push of a healthy hysteria entry would teach an operator to
    // ignore the one line that matters.
    expect(warnings.filter((w) => w.includes('builds no fragments'))).toEqual([]);
  });
});
