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
import { getChainForNode } from './cascade.service.js';
import { CHAIN_SOCKS_USER, chainSocksPort } from './chain.ports.js';

/**
 * What the panel tells a HYSTERIA entry, phase 6.
 *
 * The agent hands `chain.userCore` to the one core whose engine it names, and
 * tells every other core "not you". So the engine named here is the whole
 * difference between a hysteria entry whose users go through the cascade and
 * one whose users leave from the entry country with a working connection while
 * the panel shows a cascade.
 *
 * ⚠ The entry is flipped to hysteria IN THE DATABASE, not through the API, and
 * on purpose: this file lands before the save accepts a hysteria entry at all.
 * The hand-off has to exist before the entry can be chosen, or there is a
 * window in which a hysteria entry is saved and its users are not cascaded.
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

/** A cascade with ONE direction and Auto OFF: the shape where the xray entry
 *  renders no Auto listener at all. */
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
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ countryCode: 'NL', nodeIds: [exit] }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string };
}

async function makeEntryHysteria(cascadeId: string) {
  await prisma.cascadePosition.updateMany({
    where: { cascadeId, position: 0 },
    data: { entryProtocol: 'hysteria' },
  });
}

describe('the chain block of a hysteria entry', () => {
  it('names hysteria and hands it the Auto listener, not xray fragments', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await makeCascade(entry, nl);
    await makeEntryHysteria(c.id);

    const chain = await getChainForNode(entry);
    expect(chain?.userCore).toEqual({
      engine: 'hysteria',
      socks: { port: chainSocksPort(0), username: CHAIN_SOCKS_USER, password: chain!.socksPassword },
    });
    // No fragments beside it: the agent refuses a block whose halves do not
    // match its engine, and refuses it for every core at once.
    expect(chain!.userCore).not.toHaveProperty('fragments');
  });

  it('renders the Auto listener on a cascade with one direction and Auto off', async () => {
    // The case that would otherwise have nothing on 26000: an xray entry of this
    // same cascade renders only its one direction's listener, and a hysteria
    // entry pointed at 26000 would dial a dead port.
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    const c = await makeCascade(entry, nl);

    const asXray = await getChainForNode(entry);
    expect(asXray!.socks.map((s) => s.tag)).toEqual([1]);

    await makeEntryHysteria(c.id);
    const asHysteria = await getChainForNode(entry);
    expect(asHysteria!.socks).toEqual([
      { tag: 0, port: chainSocksPort(0) },
      { tag: 1, port: chainSocksPort(1) },
    ]);
    // And the chain process really listens there, with the user the hand-off
    // presents. A hand-off to a port the process does not open is the same dead
    // end one level down.
    const inbounds = (asHysteria!.config as { inbounds: Record<string, unknown>[] }).inbounds;
    const auto = inbounds.find((i) => i.listen_port === chainSocksPort(0)) as
      | { type: string; listen: string; users: { username: string; password: string }[] }
      | undefined;
    expect(auto?.type).toBe('socks');
    expect(auto?.listen).toBe('127.0.0.1');
    expect(auto?.users).toEqual([{ username: CHAIN_SOCKS_USER, password: asHysteria!.socksPassword }]);
  });

  it('leaves an xray entry exactly as it was', async () => {
    const entry = await makeNode('ru-entry');
    const nl = await makeNode('nl-exit');
    await makeCascade(entry, nl);

    const chain = await getChainForNode(entry);
    expect(chain?.userCore?.engine).toBe('xray');
    expect(chain!.userCore).toHaveProperty('fragments');
  });

  it.runIf(SINGBOX_BIN)('is a chain config the engine accepts, Auto over one way out', () => {
    // A urltest group of one is what a single-direction hysteria entry renders.
    // Asked of the engine rather than assumed from the documentation.
    return (async () => {
      const entry = await makeNode('ru-entry');
      const nl = await makeNode('nl-exit');
      const c = await makeCascade(entry, nl);
      await makeEntryHysteria(c.id);
      const chain = await getChainForNode(entry);

      const dir = mkdtempSync(join(tmpdir(), 'iceslab-hy-entry-'));
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
