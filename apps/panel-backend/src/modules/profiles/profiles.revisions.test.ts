import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { enforceScopes } from '../auth/scope.hook.js';
import { profilesRoutes } from './profiles.routes.js';

vi.mock('../../lib/infra/redis.js', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(0),
    mget: vi.fn().mockResolvedValue([null, null]),
  },
}));

const app = Fastify();
const profiles = '/api/profiles';
const config = { security: 'none', network: 'raw', subprotocol: 'vless' };
const updated = 'profile.updated';
let alice: string;
let bob: string;
let readOnly: string;
let writeOnly: string;
let otherScope: string;

async function token(name: string, scopes: string[]): Promise<string> {
  const value = `icp_${randomUUID()}`;
  await prisma.apiToken.create({ data: {
    name, scopes, tokenHash: createHash('sha256').update(value).digest('hex'), lastUsedAt: new Date(),
  } });
  return value;
}

beforeAll(async () => {
  await app.register(jwt, { secret: randomUUID() });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    return reply.send(error);
  });
  app.addHook('preHandler', enforceScopes);
  await app.register(profilesRoutes);
  await app.ready();
});

beforeEach(async () => {
  await cleanDatabase();
  const admin = await prisma.adminUser.create({ data: { username: 'alice', passwordHash: 'test-only' } });
  alice = app.jwt.sign({ sub: admin.id, role: admin.role, jti: randomUUID(), iatMs: Date.now() });
  bob = await token('bob integration', ['profiles:read', 'profiles:write']);
  readOnly = await token('reader', ['profiles:read']);
  writeOnly = await token('writer', ['profiles:write']);
  otherScope = await token('other', ['nodes:read']);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, auth: string, payload?: object) {
  return app.inject({ method, url, headers: auth ? { authorization: `Bearer ${auth}` } : {}, ...(payload ? { payload } : {}) });
}

async function create(name: string, overrides: object = {}) {
  const res = await request('POST', profiles, alice, {
    name, protocol: 'xray', config, revisionSource: 'form', ...overrides,
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

function list(id: string, auth = alice) {
  return request('GET', `${profiles}/${id}/revisions`, auth);
}

function compare(id: string, revision: number, auth = alice) {
  return request('GET', `${profiles}/${id}/revisions/${revision}/diff`, auth);
}

function restore(id: string, target: number, expectedCurrentRevision: number, auth = alice) {
  return request('POST', `${profiles}/${id}/revisions/${target}/restore`, auth, { expectedCurrentRevision });
}

async function edit(id: string, payload: object, auth = alice) {
  const res = await request('PUT', `${profiles}/${id}`, auth, payload);
  expect(res.statusCode).toBe(200);
}

async function documentBytes(id: string, revision: number) {
  const rows = await prisma.$queryRaw<{ bytes: string }[]>`
    SELECT document::text AS bytes FROM profile_revisions WHERE profile_id = ${id}::uuid AND revision = ${revision}`;
  return rows[0]?.bytes;
}

it('captures a legacy profile and keeps byte-identical documents through repeated restores', async () => {
  const oldConfig = { subprotocol: 'socks', security: 'none', network: 'raw' };
  const oldDate = new Date('2026-10-01T00:00:00Z');
  const { id } = await prisma.profile.create({ data: {
    name: 'legacy', protocol: 'xray', description: 'original', config: oldConfig, updatedAt: oldDate,
  } });
  const baseline = (await list(id)).json();
  expect(baseline).toMatchObject({
    currentRevision: 1, revisions: [{ revision: 1, kind: 'baseline', actor: null, createdAt: oldDate.toISOString() }],
  });
  expect((await list(id)).json()).toEqual(baseline);
  await edit(id, { description: 'changed', enabled: false, revisionSource: 'console' }, bob);
  const diff = (await compare(id, 1)).json();
  expect(diff).toEqual({
    currentRevision: 2, targetRevision: 1, protectedConfigChanged: false,
    changes: [
      { path: ['description'], before: 'changed', after: 'original', kind: 'changed' },
      { path: ['enabled'], before: false, after: true, kind: 'changed' },
    ],
  });

  for (const [target, current] of [[1, 2], [2, 3], [1, 4]] as const) {
    const response = await restore(id, target, current);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ currentRevision: current + 1, restoredFrom: target });
    expect(await documentBytes(id, current + 1)).toBe(await documentBytes(id, target));
    expect((await compare(id, target)).json().changes).toEqual([]);
  }

  expect((await list(id)).json()).toMatchObject({
    currentRevision: 5,
    revisions: [
      { revision: 5, kind: 'restored', restoredFrom: 1, actor: { type: 'admin', name: 'alice' }, source: null },
      { revision: 4, kind: 'restored', restoredFrom: 2 },
      { revision: 3, kind: 'restored', restoredFrom: 1 },
      { revision: 2, kind: 'updated', actor: { type: 'apiToken', name: 'bob integration' }, source: 'console' },
      { revision: 1, kind: 'baseline', createdAt: oldDate.toISOString() },
    ],
  });
});

it('rejects a stale confirmation after another operator edits and applies a repeated confirmation once', async () => {
  const id = await create('two-operators');
  await edit(id, { description: 'alice edit', revisionSource: 'form' });
  const opened = (await compare(id, 1)).json<{ currentRevision: number }>().currentRevision;
  await edit(id, { description: 'bob edit' }, bob);

  const stale = await restore(id, 1, opened);
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: 'PROFILE_REVISION_CONFLICT', currentRevision: 3 });
  expect((await request('GET', `${profiles}/${id}`, alice)).json().description).toBe('bob edit');

  const refreshed = (await compare(id, 1)).json<{ currentRevision: number }>().currentRevision;
  const applied = vi.spyOn(eventBus, 'emit');
  try {
    const [first, second] = await Promise.all([restore(id, 1, refreshed), restore(id, 1, refreshed, bob)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const retry = await restore(id, 1, refreshed); // Same payload after losing a successful response.
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual({ error: 'PROFILE_REVISION_CONFLICT', currentRevision: 4 });
    expect(applied.mock.calls.filter(([event]) => event === updated)).toHaveLength(1);
  } finally {
    applied.mockRestore();
  }
  expect((await list(id)).json()).toMatchObject({
    currentRevision: 4, revisions: [
      { revision: 4, kind: 'restored', restoredFrom: 1 },
      { revision: 3, kind: 'updated' },
      { revision: 2, kind: 'updated' },
      { revision: 1, kind: 'created', source: 'form' },
    ],
  });
  expect(await documentBytes(id, 4)).toBe(await documentBytes(id, 1));
  expect((await request('GET', `${profiles}/${id}`, alice)).json().description).toBeNull();
});

it('restores operator config after rotation without storing, returning or reinstating old key material', async () => {
  const oldKeys = { realityPrivateKey: 'fake-before-private', realityPublicKey: 'fake-before-public', realityShortIds: ['ae01'] };
  const liveKeys = { realityPrivateKey: 'fake-after-private', realityPublicKey: 'fake-after-public', realityShortIds: ['ae02'] };
  const reality = { ...config, security: 'reality', realityDest: 'initial.example:443', realityServerNames: ['initial.example'] };
  const id = await create('rotation', { config: { ...reality, ...oldKeys } });
  await edit(id, { config: { ...reality, ...liveKeys, realityDest: 'updated.example:443' } });
  const preview = await compare(id, 1);
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({
    protectedConfigChanged: true,
    changes: [{ path: ['config', 'realityDest'], before: 'updated.example:443', after: 'initial.example:443' }],
  });
  const result = await restore(id, 1, 2);
  expect(result.statusCode).toBe(200);
  const saved = await prisma.profile.findUniqueOrThrow({ where: { id } });
  expect(saved.config).toMatchObject({ realityDest: 'initial.example:443', ...liveKeys });
  const original = await documentBytes(id, 1);
  const rotated = await documentBytes(id, 2);
  const restored = await documentBytes(id, 3);
  expect(restored).toBe(original);
  const history = [original, rotated, restored, result.body, preview.body, (await list(id)).body].join('\n');
  for (const marker of ['fake-before', 'fake-after', 'realityPrivateKey', 'realityPublicKey', 'realityShortIds', 'ae01', 'ae02']) {
    expect(history.includes(marker)).toBe(false);
  }
});

it('rejects a restore that would strip live keys and leaves the history and row unchanged', async () => {
  const id = await create('restore-incompatible', { config: { ...config, subprotocol: 'socks' } });
  await edit(id, { config: { ...config, security: 'reality', realityPrivateKey: 'test-live-private' } });
  const before = await prisma.profile.findUniqueOrThrow({ where: { id } });
  const response = await restore(id, 1, 2);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: 'PROFILE_REVISION_PROTECTED', currentRevision: 2 });
  expect(await prisma.profile.findUniqueOrThrow({ where: { id } })).toEqual(before);
  expect((await list(id)).json().currentRevision).toBe(2);
});

it('enforces profile read and write rights and keeps history scoped to an existing profile', async () => {
  const id = await create('permissions-a');
  const other = await create('permissions-b');
  await edit(other, { description: 'other edit' });
  expect((await list(id, '')).statusCode).toBe(401);
  expect((await list(id, otherScope)).statusCode).toBe(403);
  expect((await list(id, writeOnly)).statusCode).toBe(403);
  expect((await compare(id, 1, readOnly)).statusCode).toBe(200);
  expect((await compare(id, 2, readOnly)).statusCode).toBe(404);
  expect((await restore(id, 1, 1, readOnly)).statusCode).toBe(403);
  expect((await restore(id, 2, 1, writeOnly)).statusCode).toBe(404);
  expect((await request('DELETE', `${profiles}/${id}`, alice)).statusCode).toBe(204);
  expect((await list(id)).statusCode).toBe(404);
  expect(await prisma.profileRevision.count({ where: { profileId: id } })).toBe(0);
});

type Pair = {
  label: string;
  protocol: string;
  effectiveEngine: string;
  engine?: string;
  awgProtocol?: number;
  initial: Record<string, unknown>;
  edit: Record<string, unknown>;
  secretFields?: readonly string[];
};

const realityKeys = { realityPublicKey: 'test-pair-public', realityPrivateKey: 'test-pair-private', realityShortIds: ['bc23'] };
const reality = { ...config, security: 'reality', realityDest: 'a.example:443', realityServerNames: ['a.example'], ...realityKeys };
const tls = { tlsCert: 'test-pair-certificate', tlsKey: 'test-pair-tls-key' };
const hyd = { masqueradeUrl: 'https://a.example/', obfsPassword: 'test-pair-obfuscation-password' };
const ss = { method: '2022-blake3-aes-256-gcm', serverPsk: Buffer.alloc(32, 12).toString('base64') };
const awg = {
  subnet: '10.124.0.0/24', obfuscation: {},
  serverPrivateKey: 'test-pair-awg-private', serverPublicKey: 'test-pair-awg-public',
};
const shadow = { handshake: 'a.example', ssPassword: Buffer.alloc(16, 15).toString('base64') };

const pairs: Pair[] = [
  { label: 'VLESS / Xray', protocol: 'xray', effectiveEngine: 'xray', initial: reality,
    edit: { realityDest: 'b.example:443' }, secretFields: Object.keys(realityKeys) },
  { label: 'VMess / Xray', protocol: 'xray', effectiveEngine: 'xray',
    initial: { ...config, security: 'tls', tlsServerName: 'a.example', subprotocol: 'vmess', ...tls },
    edit: { tlsServerName: 'b.example' }, secretFields: Object.keys(tls) },
  { label: 'Trojan / Xray', protocol: 'xray', effectiveEngine: 'xray', initial: { ...reality, subprotocol: 'trojan' },
    edit: { realityDest: 'b.example:443' }, secretFields: Object.keys(realityKeys) },
  { label: 'SOCKS5 / Xray', protocol: 'xray', effectiveEngine: 'xray', initial: { ...config, subprotocol: 'socks' }, edit: {} },
  { label: 'HTTP / Xray', protocol: 'xray', effectiveEngine: 'xray', initial: { ...config, subprotocol: 'http' }, edit: {} },
  { label: 'VLESS / sing-box', protocol: 'xray', effectiveEngine: 'singbox', engine: 'singbox',
    initial: reality, edit: { realityDest: 'b.example:443' }, secretFields: Object.keys(realityKeys) },
  { label: 'Trojan / sing-box', protocol: 'xray', effectiveEngine: 'singbox', engine: 'singbox',
    initial: { ...reality, subprotocol: 'trojan' }, edit: { realityDest: 'b.example:443' }, secretFields: Object.keys(realityKeys) },
  ...[
    { label: 'Hysteria 2 / Hysteria', effectiveEngine: 'hysteria' },
    { label: 'Hysteria 2 / sing-box', effectiveEngine: 'singbox', engine: 'singbox' },
  ].map((pair) => ({ ...pair, protocol: 'hysteria', initial: hyd, edit: { masqueradeUrl: 'https://b.example/' }, secretFields: ['obfsPassword'] })),
  ...[
    { label: 'Shadowsocks 2022 / Xray', effectiveEngine: 'xray' },
    { label: 'Shadowsocks 2022 / sing-box', effectiveEngine: 'singbox', engine: 'singbox' },
  ].map((pair) => ({ ...pair, protocol: 'shadowsocks', initial: ss, edit: { method: '2022-blake3-chacha20-poly1305' }, secretFields: ['serverPsk'] })),
  { label: 'AmneziaWG 1 / native', protocol: 'amneziawg', effectiveEngine: 'amneziawg',
    initial: awg, edit: { obfuscation: { jc: 5 } }, secretFields: ['serverPrivateKey', 'serverPublicKey'] },
  { label: 'AmneziaWG 3.1 / native', protocol: 'amneziawg', effectiveEngine: 'amneziawg', awgProtocol: 3,
    initial: awg, edit: { subnet: '10.125.0.0/24' }, secretFields: ['serverPrivateKey', 'serverPublicKey'] },
  { label: 'NaiveProxy / native', protocol: 'naive', effectiveEngine: 'naive',
    initial: { hostname: 'proxy.example', tlsEmail: 'operator@example.test', masqueradeRoot: '/var/www/html' }, edit: { masqueradeRoot: '/var/www/updated' } },
  { label: 'MTProto / mtg', protocol: 'mtproto', effectiveEngine: 'mtproto',
    initial: { domain: 'a.example' }, edit: {}, secretFields: ['domain'] },
  { label: 'Mieru / native', protocol: 'mieru', effectiveEngine: 'mieru', initial: { mtu: 1400 }, edit: { mtu: 1300 } },
  { label: 'TUIC / sing-box', protocol: 'tuic', effectiveEngine: 'singbox',
    initial: { serverName: 'a.example' }, edit: { congestionControl: 'cubic' } },
  { label: 'AnyTLS / sing-box', protocol: 'anytls', effectiveEngine: 'singbox',
    initial: { serverName: 'a.example' }, edit: { serverName: 'b.example' } },
  { label: 'ShadowTLS / sing-box', protocol: 'shadowtls', effectiveEngine: 'singbox',
    initial: shadow, edit: { handshake: 'b.example' }, secretFields: ['ssPassword'] },
];

const explicitAliases = pairs
  .filter(({ engine, effectiveEngine }) => engine === undefined && ['xray', 'hysteria', 'singbox'].includes(effectiveEngine))
  .map((pair) => ({ ...pair, label: pair.label + ' (explicit engine)', engine: pair.effectiveEngine }));

it.each([...pairs, ...explicitAliases])('round-trips $label', async (pair) => {
  const { protocol, effectiveEngine, engine, awgProtocol, initial, edit: changes, secretFields = [] } = pair;
  const id = await create('protocol-matrix', { protocol, config: initial, engine, awgProtocol });
  const url = `${profiles}/${id}`;
  const before = (await request('GET', url, alice)).json();
  expect(before).toMatchObject({ protocol, effectiveEngine, engine: engine ?? null, awgProtocol: awgProtocol ?? null });
  const nextConfig = { ...before.config, ...changes };
  await edit(id, { config: nextConfig, enabled: false, revisionSource: 'form' });
  const after = (await request('GET', url, alice)).json();
  expect(after).toMatchObject({ config: changes, enabled: false, effectiveEngine });
  const history = await list(id);
  const preview = await compare(id, 1);
  expect(history.json()).toMatchObject({ revisions: [
    { revision: 2, kind: 'updated' }, { revision: 1, kind: 'created' },
  ] });
  expect(preview.json()).toMatchObject({ currentRevision: 2, targetRevision: 1, protectedConfigChanged: false });
  expect(preview.json().changes).toContainEqual({ path: ['enabled'], before: false, after: true, kind: 'changed' });
  for (const key of Object.keys(changes)) {
    expect(preview.json().changes.some(({ path }: { path: string[] }) => path[0] === 'config' && path[1] === key)).toBe(true);
  }

  const response = await restore(id, 1, 2);
  expect(response.statusCode).toBe(200);
  const restored = (await request('GET', url, alice)).json();
  expect(restored.config).toEqual(before.config);
  expect(restored).toMatchObject({ effectiveEngine, engine: engine ?? null, awgProtocol: awgProtocol ?? null, enabled: true });
  const firstBytes = await documentBytes(id, 1);
  const restoredBytes = await documentBytes(id, 3);
  expect(restoredBytes).toBe(firstBytes);
  expect((await list(id)).json().revisions[0]).toMatchObject({ kind: 'restored', revision: 3, restoredFrom: 1 });
  const revisionPayloads = [history.body, preview.body, response.body, firstBytes, await documentBytes(id, 2), restoredBytes].join('\n');
  for (const field of secretFields) {
    expect(revisionPayloads.includes(field)).toBe(false);
    const value = initial[field];
    const values = Array.isArray(value) ? value : [value];
    for (const marker of values) expect(revisionPayloads.includes(String(marker))).toBe(false);
    expect(restored.config[field]).toEqual(before.config[field]);
  }
});

it.each([
  ['VMess / sing-box', 'xray', 'singbox', { ...reality, subprotocol: 'vmess' }],
  ['SOCKS5 / sing-box', 'xray', 'singbox', { ...config, subprotocol: 'socks' }],
  ['HTTP / sing-box', 'xray', 'singbox', { ...config, subprotocol: 'http' }],
  ['VLESS TLS / sing-box', 'xray', 'singbox', { ...config, security: 'tls', ...tls }],
  ['Trojan WS / sing-box', 'xray', 'singbox', { ...reality, subprotocol: 'trojan', network: 'ws' }],
  ['MTProto / sing-box', 'mtproto', 'singbox', { domain: 'a.example' }],
  ['WEB', 'telegramweb', undefined, {}],
])('rejects %s without creating a revision', async (_label, protocol, engine, config) => {
  const response = await request('POST', profiles, alice, { name: 'rejected-pair', protocol, engine, config });
  expect(response.statusCode).toBe(400);
  expect(await prisma.profile.count()).toBe(0);
  expect(await prisma.profileRevision.count()).toBe(0);
});

it('does not recreate the previous derived MTProto credential on an existing binding', async () => {
  const id = await create('mtproto-bound', { protocol: 'mtproto', config: { domain: 'a.example' } });
  const { id: nodeId } = await prisma.node.create({ data: { name: 'isolated', address: '192.0.2.10', heartbeatSecret: Buffer.alloc(32) } });
  await prisma.profileNodeBinding.create({ data: { profileId: id, nodeId, port: 443, transport: 'tcp' } });
  await edit(id, { config: { domain: 'b.example' } });
  const diff = await compare(id, 1);
  expect(diff.json()).toMatchObject({ changes: [], protectedConfigChanged: true });
  expect(diff.body).not.toContain('a.example');
  expect(await documentBytes(id, 1)).not.toContain('a.example');
  const response = await restore(id, 1, 2);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: 'PROFILE_REVISION_PROTECTED', currentRevision: 2 });
  expect((await request('GET', `${profiles}/${id}`, alice)).json().config).toEqual({ domain: 'b.example' });
  expect((await list(id)).json().currentRevision).toBe(2);
});

it('restores the absence of an Xray socket option that an ordinary save preserves', async () => {
  const id = await create('socket-option');
  await edit(id, { config: { ...config, tcpUserTimeout: 5000 } });
  await edit(id, { config });
  expect((await list(id)).json().currentRevision).toBe(2);
  expect((await restore(id, 1, 2)).statusCode).toBe(200);
  expect((await request('GET', `${profiles}/${id}`, alice)).json().config).not.toHaveProperty('tcpUserTimeout');
  expect(await documentBytes(id, 1)).toBe(await documentBytes(id, 3));
});

it('round-trips a saved engine change and preserves JSON null in the diff', async () => {
  const id = await create('engine-switch', { config: reality });
  await edit(id, { engine: 'singbox' });
  expect((await compare(id, 1)).json()).toMatchObject({
    changes: [{ path: ['engine'], before: 'singbox', after: null, kind: 'changed' }],
  });
  expect((await restore(id, 1, 2)).statusCode).toBe(200);
  const profile = (await request('GET', `${profiles}/${id}`, alice)).json();
  expect(profile).toMatchObject({ engine: null, effectiveEngine: 'xray' });
  expect(await documentBytes(id, 3)).toBe(await documentBytes(id, 1));
});

it('paginates through the head without repeating or omitting a revision', async () => {
  const id = await create('paged-history');
  for (let i = 0; i < 31; i++) await edit(id, { description: `Change ${i}` });
  const first = (await list(id)).json();
  const tail = (await request('GET', `${profiles}/${id}/revisions?before=${first.nextBefore}`, alice)).json();
  expect(first).toMatchObject({ currentRevision: 32, nextBefore: 3 });
  expect(tail).toMatchObject({ currentRevision: 32, nextBefore: null });
  expect([...first.revisions, ...tail.revisions].map(({ revision }) => revision))
    .toEqual(Array.from({ length: 32 }, (_, i) => 32 - i));
});

it('validates and moves a bound transport on restore in the same transaction', async () => {
  const id = await create('bound-restore', { config: { ...reality, network: 'kcp' } });
  const rival = await create('rival', { config: { ...reality, network: 'kcp' } });
  const { id: nodeId } = await prisma.node.create({ data: {
    name: 'transport-fixture', address: '192.0.2.11', heartbeatSecret: Buffer.alloc(32),
  } });
  const { id: bindingId } = await prisma.profileNodeBinding.create({
    data: { profileId: id, nodeId, port: 443, transport: 'udp' },
  });
  await edit(id, { config: reality });
  const transport = async () => (await prisma.profileNodeBinding.findUniqueOrThrow({ where: { id: bindingId } })).transport;
  expect(await transport()).toBe('tcp');
  const blocker = await prisma.profileNodeBinding.create({
    data: { profileId: rival, nodeId, port: 443, transport: 'udp' },
  });
  const refused = await restore(id, 1, 2);
  expect(refused.statusCode).toBe(409);
  expect(refused.json().error).toBe('TRANSPORT_MOVE_BLOCKED');
  expect(await transport()).toBe('tcp');
  expect((await list(id)).json().currentRevision).toBe(2);

  await prisma.profileNodeBinding.delete({ where: { id: blocker.id } });
  expect((await restore(id, 1, 2)).statusCode).toBe(200);
  expect(await transport()).toBe('udp');
  expect(await documentBytes(id, 3)).toBe(await documentBytes(id, 1));
});
