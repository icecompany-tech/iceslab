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
import { getChainForNode, getHysteriaEntryLabels } from './cascade.service.js';
import { renderChainConfig, TPROXY_IN_TAG } from './chain.config.js';
import { CHAIN_TPROXY_PORT, chainTProxyMark } from './chain.ports.js';
import { observedCores } from '../nodes/nodes.cron.js';

/**
 * What the panel tells an AMNEZIAWG entry, t07-wire.
 *
 * The agent steers the awg interface's packets into the chain by TPROXY
 * (amneziawg ApplyCascade draws the rules) and the chain listens for them on
 * loopback. Both halves go out in one push, and this file holds the panel's:
 * the hand-off names amneziawg with the interface's own mark, and the chain
 * config has the listener that hand-off points at.
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

async function bindAwg(nodeId: string, port: number, generation: 1 | 3 = 1) {
  seq += 1;
  const p = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: {
      name: `awg-${seq}`,
      protocol: 'amneziawg',
      ...(generation === 3 ? { awgProtocol: 3 } : {}),
      config: {
        serverPrivateKey: 'a'.repeat(44),
        serverPublicKey: 'b'.repeat(44),
        subnet: generation === 3 ? '10.67.67.0/24' : '10.66.66.0/24',
        obfuscation: {},
      },
    },
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

/** A node whose agent says it carries the 3.1 interface (AWG_AGENT_TOO_OLD). */
async function carriesBoth(nodeId: string) {
  await prisma.node.update({
    where: { id: nodeId },
    data: {
      cores: observedCores(
        [
          { name: 'amneziawg', engine: 'amneziawg', running: true, installed: true, awgProtocol: 3, awgGenerations: [1, 3] },
          // The chain runs on sing-box; an entry that reports none is refused.
          { name: 'tuic', engine: 'singbox', running: true, installed: true },
        ],
        new Date().toISOString(),
      ) as unknown as object,
    },
  });
}

/** One direction, Auto off: the shape where an xray entry renders no Auto. */
async function makeCascade(entry: string, exit: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      autoProfile: false,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'amneziawg', linkProtocol: 'vless' }],
      directions: [{ countryCode: 'NL', nodeIds: [exit] }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string; name: string };
}

type Inbound = { type: string; tag: string; listen?: string; listen_port?: number };
type Rule = { inbound?: string[]; action?: string; outbound?: string };

describe('the chain block of an amneziawg entry', () => {
  it('names amneziawg and hands it the tproxy listener with the interface mark', async () => {
    const entry = await makeNode('ru-entry');
    await bindAwg(entry, 51820);
    await makeCascade(entry, await makeNode('nl-exit'));

    const chain = await getChainForNode(entry);
    expect(chain?.userCore).toEqual({
      engine: 'amneziawg',
      tproxy: { port: CHAIN_TPROXY_PORT, mark: chainTProxyMark(51820) },
    });
    expect(chain!.userCore).not.toHaveProperty('fragments');
    expect(chain!.userCore).not.toHaveProperty('socks');
  });

  it('takes the mark of the interface the agent ends up with, the highest port', async () => {
    // Pushed in port order, each AWG inbound replacing the last on the one
    // interface the adapter carries.
    const entry = await makeNode('ru-entry');
    await bindAwg(entry, 443);
    await bindAwg(entry, 51820);
    await makeCascade(entry, await makeNode('nl-exit'));
    const chain = await getChainForNode(entry);
    expect(chain?.userCore).toMatchObject({ tproxy: { mark: chainTProxyMark(51820) } });
  });

  it('hands each interface over with its own mark, 1.x and 3.1 (t07-6b)', async () => {
    const entry = await makeNode('ru-entry');
    await carriesBoth(entry);
    await bindAwg(entry, 51820);
    await bindAwg(entry, 51830, 3);
    await makeCascade(entry, await makeNode('nl-exit'));
    const chain = await getChainForNode(entry);
    expect(chain?.userCore).toEqual({
      engine: 'amneziawg',
      tproxy: { port: CHAIN_TPROXY_PORT, mark: chainTProxyMark(51820) },
      tproxy3: { port: CHAIN_TPROXY_PORT, mark: chainTProxyMark(51830) },
    });
  });

  it('hands over the 3.1 interface alone on an entry that serves 3.1 alone', async () => {
    const entry = await makeNode('ru-entry');
    await carriesBoth(entry);
    await bindAwg(entry, 51830, 3);
    await makeCascade(entry, await makeNode('nl-exit'));
    const chain = await getChainForNode(entry);
    expect(chain?.userCore).toEqual({
      engine: 'amneziawg',
      tproxy3: { port: CHAIN_TPROXY_PORT, mark: chainTProxyMark(51830) },
    });
  });

  it('hands nothing over when the entry serves no AmneziaWG at all', async () => {
    const entry = await makeNode('ru-entry');
    await makeCascade(entry, await makeNode('nl-exit'));
    const chain = await getChainForNode(entry);
    expect(chain).not.toBeNull();
    expect(chain!.userCore).toBeUndefined();
  });

  it('has the chain listen where the hand-off points, and route it to Auto', async () => {
    const entry = await makeNode('ru-entry');
    await bindAwg(entry, 51820);
    await makeCascade(entry, await makeNode('nl-exit'));
    const chain = await getChainForNode(entry);
    const config = chain!.config as { inbounds: Inbound[]; route: { rules: Rule[] }; outbounds: { tag: string }[] };

    const tp = config.inbounds.find((i) => i.type === 'tproxy');
    expect(tp).toEqual({ type: 'tproxy', tag: TPROXY_IN_TAG, listen: '127.0.0.1', listen_port: CHAIN_TPROXY_PORT });
    // Auto exists with one direction and Auto switched off, as for hysteria.
    expect(config.outbounds.some((o) => o.tag === 'out-d0')).toBe(true);
    expect(config.route.rules).toContainEqual({ inbound: [TPROXY_IN_TAG], action: 'route', outbound: 'out-d0' });
  });

  it('an xray entry and a hysteria entry have no tproxy listener', async () => {
    const entry = await makeNode('ru-entry');
    const c = await makeCascade(entry, await makeNode('nl-exit'));
    for (const protocol of ['xray', 'hysteria']) {
      await prisma.cascadePosition.updateMany({ where: { cascadeId: c.id, position: 0 }, data: { entryProtocol: protocol } });
      const chain = await getChainForNode(entry);
      const inbounds = (chain!.config as { inbounds: Inbound[] }).inbounds;
      expect(inbounds.some((i) => i.type === 'tproxy'), protocol).toBe(false);
    }
  });

  it('names the awg host of the entry after the cascade in the subscription', async () => {
    const entry = await makeNode('ru');
    await bindAwg(entry, 51820);
    await makeCascade(entry, await makeNode('nl'));
    expect((await getHysteriaEntryLabels([entry], [], undefined, 'amneziawg')).get(entry)).toMatch(/NL/);
    // And a hysteria question about the same entry finds nothing.
    expect((await getHysteriaEntryLabels([entry])).has(entry)).toBe(false);
  });

  it.runIf(SINGBOX_BIN)('is a chain config the engine accepts', () => {
    return (async () => {
      const entry = await makeNode('ru-entry');
      await bindAwg(entry, 51820);
      await makeCascade(entry, await makeNode('nl-exit'));
      const chain = await getChainForNode(entry);
      const dir = mkdtempSync(join(tmpdir(), 'iceslab-awg-entry-'));
      const file = join(dir, 'config.json');
      writeFileSync(file, JSON.stringify(chain!.config, null, 2));
      let output = '';
      let ok = true;
      try {
        output = execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' });
      } catch (err) {
        ok = false;
        const e = err as { stdout?: string; stderr?: string };
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }
      expect(ok, output).toBe(true);
    })();
  });
});

describe('the policy on the tproxy listener', () => {
  const out = [{ tag: 1, host: 'nl.test', cred: { protocol: 'shadowsocks', port: 24001, method: '2022-blake3-aes-128-gcm', psk: 'x' } }];
  const policy = { ordinal: 2, block: { domain_suffix: ['ads.test'] }, direct: { domain_suffix: ['ru'] } };

  it('gates the entry policy on the listener, since TPROXY carries no user', () => {
    const cfg = renderChainConfig({
      role: 'entry',
      socksPassword: 'pw',
      directionTags: [0, 1],
      out: out as never,
      policies: [policy],
      tproxy: { ordinal: 2 },
    }) as { route: { rules: Record<string, unknown>[] } };
    expect(cfg.route.rules).toContainEqual({ inbound: [TPROXY_IN_TAG], domain_suffix: ['ads.test'], action: 'reject', method: 'drop' });
    expect(cfg.route.rules).toContainEqual({ inbound: [TPROXY_IN_TAG], domain_suffix: ['ru'], action: 'route', outbound: 'direct' });
    // Before the way out, or the door would match first.
    const idx = (r: Record<string, unknown>) => cfg.route.rules.indexOf(r);
    const block = cfg.route.rules.find((r) => r.inbound && r.action === 'reject')!;
    const door = cfg.route.rules.find((r) => (r.inbound as string[] | undefined)?.[0] === TPROXY_IN_TAG && r.outbound === 'out-d0')!;
    expect(idx(block)).toBeLessThan(idx(door));
  });

  it('draws no listener rule for the plain profile, and none of another policy', () => {
    const cfg = renderChainConfig({
      role: 'entry',
      socksPassword: 'pw',
      directionTags: [0, 1],
      out: out as never,
      policies: [policy],
      tproxy: { ordinal: 0 },
    }) as { route: { rules: Record<string, unknown>[] } };
    const onListener = cfg.route.rules.filter((r) => (r.inbound as string[] | undefined)?.[0] === TPROXY_IN_TAG);
    expect(onListener).toEqual([{ inbound: [TPROXY_IN_TAG], action: 'route', outbound: 'out-d0' }]);
  });
});
