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

async function makeProfile(protocol: string, config: unknown): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: `core-profile-${seq}`, protocol, config },
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
