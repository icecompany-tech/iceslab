import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * A port is taken per TRANSPORT, not per number.
 *
 * The panel used to hold `@@unique([nodeId, port])` and refuse Hysteria2 on
 * 443/UDP beside REALITY on 443/TCP. Those are different sockets, and the pair
 * is not exotic: it is what a node looks like when it serves both H2 and H3.
 * The old key was not caution, it was a refusal of a standard configuration.
 *
 * The transport is DERIVED, never asked of the operator, and denormalised onto
 * the binding because a unique index cannot reach into `profiles` for the
 * protocol. That buys the refusal at the right layer and costs one thing: the
 * column must be kept in step on every write, including the profile edit that
 * moves an xray inbound onto kcp. The last four tests are about that cost.
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

/**
 * The node reports no cores on purpose.
 *
 * With cores reported, the engine gate would answer first and these tests
 * would be measuring that gate instead of the port key. An unreported node is
 * exactly the quiet state the gate is built to leave alone.
 */
async function makeNode(name?: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: {
      name: name ?? `port-node-${seq}`,
      address: `port-${seq}.test`,
      protocol: 'xray',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

async function makeProfile(protocol: string, config: unknown, name?: string) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name: name ?? `port-profile-${seq}`, protocol, config },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

async function bind(
  profileId: string,
  nodeId: string,
  port: number,
  opts: { expected?: number; overrides?: unknown } = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port, ...(opts.overrides ? { overrides: opts.overrides } : {}) },
  });
  expect(res.statusCode, res.body).toBe(opts.expected ?? 201);
  return JSON.parse(res.body);
}

async function editProfile(id: string, config: unknown, expected = 200) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/profiles/${id}`,
    headers: auth(),
    payload: { config },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

const transportsOf = (profileId: string) =>
  prisma.profileNodeBinding.findMany({
    where: { profileId },
    select: { port: true, transport: true },
    orderBy: { port: 'asc' },
  });

describe('one port, two sockets', () => {
  it('lets Hysteria2 onto 443/UDP beside REALITY on 443/TCP', async () => {
    // The case the old key refused, and the reason this column exists.
    const node = await makeNode();
    const xray = await makeProfile('xray', XRAY_CONFIG);
    const hysteria = await makeProfile('hysteria', {});

    await bind(xray.id, node.id, 443);
    await bind(hysteria.id, node.id, 443);

    expect(
      await prisma.profileNodeBinding.findMany({
        where: { nodeId: node.id },
        select: { port: true, transport: true },
        orderBy: { transport: 'asc' },
      }),
    ).toEqual([
      { port: 443, transport: 'tcp' },
      { port: 443, transport: 'udp' },
    ]);
  });

  it('still refuses a second listener on the SAME socket, and says why', async () => {
    const node = await makeNode('dublin-1');
    const first = await makeProfile('xray', XRAY_CONFIG, 'reality-direct');
    const second = await makeProfile('xray', XRAY_CONFIG, 'reality-cdn');

    await bind(first.id, node.id, 443);
    const refused = await bind(second.id, node.id, 443, { expected: 409 });

    // Naming the transport is half the answer: "port 443 is in use" is what
    // the panel said to somebody adding Hysteria2, and it was not true.
    expect(refused.message).toContain('443/TCP');
    expect(refused.message).toContain('dublin-1');
    expect(refused.message).toContain('reality-direct');
    // And the reason it cannot be shared, or the operator reads a hard limit
    // where there is a missing feature.
    expect(refused.message).toContain('demultiplexer');
  });

  it('files a binding that pins kcp on UDP, not on the profile transport', async () => {
    // The override merge is not decoration: a binding may pin its own network,
    // and it is the merged value the node ends up listening with. Reading the
    // profile alone would file this row under TCP and let a UDP collision in.
    const node = await makeNode();
    const xray = await makeProfile('xray', XRAY_CONFIG);
    const hysteria = await makeProfile('hysteria', {});

    await bind(hysteria.id, node.id, 8443);
    const refused = await bind(xray.id, node.id, 8443, {
      expected: 409,
      overrides: { network: 'kcp' },
    });
    expect(refused.message).toContain('8443/UDP');
  });
});

describe('a profile edit that moves the socket', () => {
  it('moves every deployed binding with it', async () => {
    const a = await makeNode();
    const b = await makeNode();
    const xray = await makeProfile('xray', XRAY_CONFIG);
    await bind(xray.id, a.id, 443);
    await bind(xray.id, b.id, 8443);
    expect(await transportsOf(xray.id)).toEqual([
      { port: 443, transport: 'tcp' },
      { port: 8443, transport: 'tcp' },
    ]);

    await editProfile(xray.id, { ...XRAY_CONFIG, network: 'kcp' });

    // Both, not the first one. A row left saying TCP while the node listens on
    // UDP is the exact lie the column exists to prevent.
    expect(await transportsOf(xray.id)).toEqual([
      { port: 443, transport: 'udp' },
      { port: 8443, transport: 'udp' },
    ]);
  });

  it('refuses the edit when the socket it moves to is taken, naming node and port', async () => {
    const node = await makeNode('frankfurt-2');
    const xray = await makeProfile('xray', XRAY_CONFIG);
    const hysteria = await makeProfile('hysteria', {}, 'hy2-main');

    await bind(xray.id, node.id, 443);
    await bind(hysteria.id, node.id, 443);

    const refused = await editProfile(xray.id, { ...XRAY_CONFIG, network: 'kcp' }, 409);
    expect(refused.error).toBe('TRANSPORT_MOVE_BLOCKED');
    expect(refused.message).toContain('frankfurt-2');
    expect(refused.message).toContain('443');
    expect(refused.message).toContain('hy2-main');
    // The machine form carries the whole list, because a profile on eight
    // nodes should not be fixed one refusal at a time.
    expect(refused.conflicts).toEqual([
      { nodeName: 'frankfurt-2', port: 443, conflictProfile: 'hy2-main' },
    ]);
  });

  it('writes nothing at all when it refuses', async () => {
    // Profile and bindings move together or not at all: a saved config with
    // bindings still on the old socket is worse than a refusal, because the
    // panel would then agree with itself while the node disagrees.
    const node = await makeNode();
    const xray = await makeProfile('xray', XRAY_CONFIG);
    const hysteria = await makeProfile('hysteria', {});
    await bind(xray.id, node.id, 443);
    await bind(hysteria.id, node.id, 443);

    await editProfile(xray.id, { ...XRAY_CONFIG, network: 'kcp' }, 409);

    const after = await prisma.profile.findUniqueOrThrow({ where: { id: xray.id } });
    expect((after.config as { network?: string }).network).toBe('raw');
    expect(await transportsOf(xray.id)).toEqual([{ port: 443, transport: 'tcp' }]);
  });

  it('leaves the bindings alone when the edit does not touch the socket', async () => {
    const node = await makeNode();
    const xray = await makeProfile('xray', XRAY_CONFIG);
    await bind(xray.id, node.id, 443);

    await editProfile(xray.id, { ...XRAY_CONFIG, network: 'ws', path: '/live' });

    expect(await transportsOf(xray.id)).toEqual([{ port: 443, transport: 'tcp' }]);
  });
});
