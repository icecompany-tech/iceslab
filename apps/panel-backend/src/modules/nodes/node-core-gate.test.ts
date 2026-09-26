import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CORE_VERSIONS, type CoreArch, type CoreStatus } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { observedCores } from './nodes.cron.js';

/**
 * A host does not go onto a node whose core for it is missing or known to be
 * wrong (docs/plan/core-lifecycle.md section 6), by the node's own report:
 *   - `installed: false`                    → 409 CORE_NOT_ON_NODE, with the
 *                                              command that installs it;
 *   - version known-bad or above-ceiling    → 409 CORE_VERSION_REFUSED;
 *   - drift                                 → not a refusal;
 *   - engine not reported, or no version    → not a refusal (incomplete fact).
 * An edit that does not move the host to another node is never gated: turning
 * a host off on a broken node has to stay possible.
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

const REALITY = {
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};

async function makeNode(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `core-node-${seq}`, address: `core-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function makeProfile(protocol: string, config: unknown, extra: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: `core-profile-${seq}`, protocol, config, ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

/** Pretend the agent checked in with these cores. */
async function report(nodeId: string, cores: Partial<CoreStatus>[], arch?: CoreArch) {
  await prisma.node.update({
    where: { id: nodeId },
    data: {
      cores: observedCores(
        cores.map((c) => ({ running: true, ...c }) as CoreStatus),
        new Date().toISOString(),
        arch,
      ) as unknown as object,
    },
  });
}

const bind = (profileId: string, nodeId: string, port = 8443) =>
  app.inject({ method: 'POST', url: '/api/bindings', headers: auth(), payload: { profileId, nodeId, port } });
const host = (profileId: string, nodeId: string, port = 8443) =>
  app.inject({
    method: 'POST',
    url: '/api/hosts',
    headers: auth(),
    payload: { profileId, nodeId, port, remark: `h-${port}` },
  });

const xrayPin = CORE_VERSIONS.xray.releases[0]!;

describe('the core gate on putting a host on a node', () => {
  it('refuses a node whose report says the core is not installed, with the command', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    await report(nodeId, [{ name: 'xray', engine: 'xray', installed: false }], 'arm64');

    for (const res of [await host(profileId, nodeId), await bind(profileId, nodeId)]) {
      expect(res.statusCode, res.body).toBe(409);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ error: 'CORE_NOT_ON_NODE', nodeName: 'core-node-1', engine: 'xray' });
      expect(body.howToInstall).toEqual({
        command:
          `sudo env XRAY_VERSION=${xrayPin.version} XRAY_SHA256=${xrayPin.assets!.arm64!.sha256} ` +
          'bash /opt/iceslab-node/apps/node/scripts/bootstrap-xray.sh --restart-agent',
        pinned: true,
      });
    }
    expect(await prisma.profileNodeBinding.count()).toBe(0);
  });

  it('gives the command without the pair, and says why, when the arch is unknown', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    await report(nodeId, [{ name: 'xray', engine: 'xray', installed: false }]);
    const body = JSON.parse((await bind(profileId, nodeId)).body);
    expect(body.howToInstall).toEqual({
      command:
        'sudo bash /opt/iceslab-node/apps/node/scripts/bootstrap-xray.sh --restart-agent',
      pinned: false,
      why: 'no-arch',
    });
  });

  it('refuses a known-bad version', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    await report(nodeId, [{ name: 'xray', engine: 'xray', installed: true, version: '26.9.8' }], 'amd64');
    const res = await host(profileId, nodeId);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'CORE_VERSION_REFUSED',
      nodeName: 'core-node-1',
      engine: 'xray',
      component: 'xray',
      version: '26.9.8',
      verdict: 'known-bad',
    });
    expect(JSON.parse(res.body).reason).toContain('X25519MLKEM768');
  });

  it('lets drift through', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    // Under the ceiling, not the pin, not known-bad: drift, a warning on the screen.
    await report(nodeId, [{ name: 'xray', engine: 'xray', installed: true, version: '26.1.1' }], 'amd64');
    const res = await host(profileId, nodeId);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('lets through a node that did not report this engine, or reported no version', async () => {
    const silent = await makeNode();
    const noVersion = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    await report(silent, [{ name: 'hysteria', engine: 'hysteria', installed: true }]);
    await report(noVersion, [{ name: 'xray', engine: 'xray', installed: true }]);
    expect((await host(profileId, noVersion)).statusCode).toBe(201);
    // Never checked in at all.
    const never = await makeNode();
    expect((await host(profileId, never)).statusCode).toBe(201);
    // No xray row at all: not this gate's refusal. (The bindings route's
    // engine-list gate is a separate, older question and may still say no.)
    const res = await bind(profileId, silent);
    expect(JSON.parse(res.body).error).not.toBe('CORE_NOT_ON_NODE');
    expect(JSON.parse(res.body).error).not.toBe('CORE_VERSION_REFUSED');
  });

  it('does not gate an edit that stays on the node', async () => {
    const nodeId = await makeNode();
    const profileId = await makeProfile('xray', REALITY);
    const created = await host(profileId, nodeId);
    expect(created.statusCode, created.body).toBe(201);
    const hostId = JSON.parse(created.body).id as string;
    const binding = await prisma.profileNodeBinding.findFirstOrThrow();
    // The core disappears afterwards.
    await report(nodeId, [{ name: 'xray', engine: 'xray', installed: false }], 'amd64');

    const off = await app.inject({
      method: 'PUT',
      url: `/api/hosts/${hostId}`,
      headers: auth(),
      payload: { enabled: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    const port = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${binding.id}`,
      headers: auth(),
      payload: { enabled: false },
    });
    expect(port.statusCode, port.body).toBe(200);
  });
});

const AWG = {
  serverPrivateKey: 'a'.repeat(44),
  serverPublicKey: 'b'.repeat(44),
  subnet: '10.66.66.0/24',
  obfuscation: {},
};

/** An AmneziaWG row as the agent reports it after t07-6: the module's
 *  generation, and what the agent carries (both, unless said otherwise). */
const awgRow = (
  awgProtocol?: 1 | 3,
  version = awgProtocol === 3 ? '3.1.20260906' : '1.0.20260611',
  // null = the agent does not report the field (older than t07-6).
  awgGenerations: (1 | 3)[] | null = [1, 3],
) => ({
  name: 'amneziawg' as const,
  engine: 'amneziawg' as const,
  installed: true,
  version,
  ...(awgProtocol ? { awgProtocol } : {}),
  ...(awgGenerations ? { awgGenerations } : {}),
});

const getNode = async (id: string) =>
  JSON.parse((await app.inject({ method: 'GET', url: `/api/nodes/${id}`, headers: auth() })).body);

describe('the AmneziaWG generation gate (t07-1)', () => {
  it('a profile carries its generation: 3, null for one that names none, refused off AmneziaWG', async () => {
    const three = await makeProfile('amneziawg', AWG, { awgProtocol: 3 });
    const plain = await makeProfile('amneziawg', AWG);
    const get = async (id: string) =>
      JSON.parse((await app.inject({ method: 'GET', url: `/api/profiles/${id}`, headers: auth() })).body);
    expect((await get(three)).awgProtocol).toBe(3);
    expect((await get(plain)).awgProtocol).toBeNull();

    const onXray = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'x-awg', protocol: 'xray', config: REALITY, awgProtocol: 3 },
    });
    expect(onXray.statusCode, onXray.body).toBe(400);
    const two = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: auth(),
      payload: { name: 'awg-2', protocol: 'amneziawg', config: AWG, awgProtocol: 2 },
    });
    expect(two.statusCode, two.body).toBe(400);
  });

  it('refuses a 3.1 profile on a node whose module speaks 1.x, on both doors, in machine form', async () => {
    const nodeId = await makeNode();
    await report(nodeId, [awgRow(1)], 'amd64');
    const profileId = await makeProfile('amneziawg', AWG, { awgProtocol: 3 });

    for (const res of [await bind(profileId, nodeId, 51820), await host(profileId, nodeId, 51820)]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(JSON.parse(res.body)).toMatchObject({
        error: 'AWG_PROTOCOL_MISMATCH',
        nodeName: 'core-node-1',
        profileAwgProtocol: 3,
        nodeAwgProtocol: 1,
      });
    }
    expect(await prisma.profileNodeBinding.count()).toBe(0);
  });

  it('lets a 1.x profile onto a 3.1 module, which serves both (Ф7.0 m1)', async () => {
    const nodeId = await makeNode();
    await report(nodeId, [awgRow(3)], 'amd64');
    const legacy = await makeProfile('amneziawg', AWG);
    const one = await makeProfile('amneziawg', AWG, { awgProtocol: 1 });
    // Its own subnet: the 3.1 interface cannot share the 1.x one (t07-6,
    // AWG_SUBNET_OVERLAP).
    const three = await makeProfile('amneziawg', { ...AWG, subnet: '10.67.67.0/24' }, { awgProtocol: 3 });
    expect((await bind(legacy, nodeId, 51820)).statusCode).toBe(201);
    expect((await bind(one, nodeId, 51821)).statusCode).toBe(201);
    expect((await bind(three, nodeId, 51822)).statusCode).toBe(201);
  });

  it('lets through a node whose module does not say, when its agent carries 3.1', async () => {
    const three = await makeProfile('amneziawg', AWG, { awgProtocol: 3 });
    // A raw build that says 1.0.0: no module fact, and that alone refuses nothing.
    const silent = await makeNode();
    await report(silent, [awgRow(undefined, '1.0.0')], 'amd64');
    expect((await bind(three, silent, 51820)).statusCode).toBe(201);
  });

  it('refuses a 3.1 profile where the agent does not say it carries 3.1, absence included (ARCH 26.09)', async () => {
    // An older agent reads a 3.1 inbound as 1.x and overwrites the live 1.x
    // interface with it: here, and only here, absence is a refusal.
    const three = await makeProfile('amneziawg', AWG, { awgProtocol: 3 });
    const old = await makeNode();
    await report(old, [awgRow(3, '3.1.20260906', null)], 'amd64');
    const onlyOne = await makeNode();
    await report(onlyOne, [awgRow(3, '3.1.20260906', [1])], 'amd64');
    const never = await makeNode();
    for (const res of [await bind(three, old, 51820), await bind(three, onlyOne, 51820), await host(three, never, 51820)]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'AWG_AGENT_TOO_OLD' });
    }
    // A 1.x profile asks nothing of the agent.
    const one = await makeProfile('amneziawg', { ...AWG, subnet: '10.68.68.0/24' });
    expect((await bind(one, old, 51821)).statusCode).toBe(201);
    // And a move to 3.1 over PUT, the same answer.
    const put = await app.inject({ method: 'PUT', url: `/api/profiles/${one}`, headers: auth(), payload: { awgProtocol: 3 } });
    expect(put.statusCode, put.body).toBe(409);
    expect(JSON.parse(put.body).error).toBe('AWG_AGENT_TOO_OLD');
  });

  it('a PUT that moves the subnet onto the other generation is refused as the binding would be', async () => {
    const nodeId = await makeNode();
    await report(nodeId, [awgRow(3)], 'amd64');
    const one = await makeProfile('amneziawg', AWG);
    const three = await makeProfile('amneziawg', { ...AWG, subnet: '10.67.67.0/24' }, { awgProtocol: 3 });
    expect((await bind(one, nodeId, 51820)).statusCode).toBe(201);
    expect((await bind(three, nodeId, 51830)).statusCode).toBe(201);
    const put = (payload: object) =>
      app.inject({ method: 'PUT', url: `/api/profiles/${three}`, headers: auth(), payload });
    const onto = await put({ config: { ...AWG, subnet: '10.66.66.0/24' } });
    expect(onto.statusCode, onto.body).toBe(409);
    expect(JSON.parse(onto.body)).toMatchObject({ error: 'AWG_SUBNET_OVERLAP', otherSubnet: '10.66.66.0/24' });
    expect((await put({ config: { ...AWG, subnet: '10.69.69.0/24' } })).statusCode).toBe(200);
    // Back to 1.x on its own subnet: the same generation as the other, not asked.
    expect((await put({ awgProtocol: null })).statusCode).toBe(200);
  });

  it('refuses moving a deployed profile to 3.1 while one of its nodes runs 1.x, and back is free', async () => {
    const nodeId = await makeNode();
    await report(nodeId, [awgRow(1)], 'amd64');
    const profileId = await makeProfile('amneziawg', AWG);
    expect((await bind(profileId, nodeId, 51820)).statusCode).toBe(201);

    const put = (payload: unknown) =>
      app.inject({ method: 'PUT', url: `/api/profiles/${profileId}`, headers: auth(), payload });
    const up = await put({ awgProtocol: 3 });
    expect(up.statusCode, up.body).toBe(409);
    expect(JSON.parse(up.body)).toMatchObject({ error: 'AWG_PROTOCOL_MISMATCH', nodeAwgProtocol: 1 });
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })).awgProtocol).toBeNull();

    // The module moves to 3.1: now it goes, and back to 1.x asks nothing.
    await report(nodeId, [awgRow(3)], 'amd64');
    expect((await put({ awgProtocol: 3 })).statusCode).toBe(200);
    await report(nodeId, [awgRow(1)], 'amd64');
    const back = await put({ awgProtocol: null });
    expect(back.statusCode, back.body).toBe(200);
    expect(JSON.parse(back.body).awgProtocol).toBeNull();
    // A save that does not name it leaves it alone.
    expect((await put({ awgProtocol: 3 })).statusCode).toBe(409);
    expect(JSON.parse((await put({ description: 'x' })).body).awgProtocol).toBeNull();
  });

  it('refuses a generation on a profile that is not AmneziaWG', async () => {
    const profileId = await makeProfile('xray', REALITY);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profileId}`,
      headers: auth(),
      payload: { awgProtocol: 3 },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'INVALID', path: ['awgProtocol'] });
  });

  it('the node answers with its module generation, null when the report does not say', async () => {
    const one = await makeNode();
    await report(one, [awgRow(1)]);
    const three = await makeNode();
    await report(three, [awgRow(3)]);
    const off = await makeNode();
    await report(off, [{ ...awgRow(3), installed: false }]);
    const never = await makeNode();
    expect((await getNode(one)).awgProtocol).toBe(1);
    expect((await getNode(three)).awgProtocol).toBe(3);
    expect((await getNode(three)).cores.cores[0].awgProtocol).toBe(3);
    expect((await getNode(off)).awgProtocol).toBeNull();
    expect((await getNode(never)).awgProtocol).toBeNull();
  });

  it('a node save does not take a generation: it is the module, not a choice', async () => {
    const nodeId = await makeNode();
    await report(nodeId, [awgRow(1)]);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${nodeId}`,
      headers: auth(),
      payload: { awgProtocol: 3 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await getNode(nodeId)).awgProtocol).toBe(1);
  });
});

describe('neededBy on the node response', () => {
  it('counts enabled hosts per core row, zero for an unneeded core, one query for the list', async () => {
    const nodeId = await makeNode();
    await report(
      nodeId,
      [
        { name: 'xray', engine: 'xray', installed: true },
        // Same engine, another adapter: an xray host does not need it.
        { name: 'shadowsocks', engine: 'xray', installed: true },
        { name: 'hysteria', engine: 'hysteria', installed: true },
        { name: 'tuic', engine: 'singbox', installed: false },
        // An agent older than `engine`: no key, not a guess.
        { name: 'mieru' },
      ],
      'amd64',
    );
    const xray = await makeProfile('xray', REALITY);
    const hy = await makeProfile('hysteria', {});
    expect((await host(xray, nodeId, 8443)).statusCode).toBe(201);
    expect((await host(xray, nodeId, 8443)).statusCode).toBe(201); // second host, same binding
    expect((await host(hy, nodeId, 443)).statusCode).toBe(201);
    // A disabled host is not needed.
    const off = JSON.parse((await host(hy, nodeId, 443)).body).id as string;
    await app.inject({ method: 'PUT', url: `/api/hosts/${off}`, headers: auth(), payload: { enabled: false } });

    const byId = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}`, headers: auth() })).body,
    );
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/nodes', headers: auth() })).body);
    for (const node of [byId, list.nodes.find((n: { id: string }) => n.id === nodeId)]) {
      const rows = Object.fromEntries(
        node.cores.cores.map((c: { name: string; neededBy?: number }) => [c.name, c]),
      );
      expect(rows.xray.neededBy).toBe(2);
      expect(rows.shadowsocks.neededBy).toBe(0);
      expect(rows.hysteria.neededBy).toBe(1);
      expect(rows.tuic.neededBy).toBe(0);
      expect('neededBy' in rows.mieru).toBe(false);
    }
  });
});
