import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { config } from '../../config.js';
import { prisma } from '../../prisma.js';
import { enforceScopes } from '../auth/scope.hook.js';
import { decodeNodePayload } from '../keygen/keygen.service.js';
import { nodesRoutes } from './nodes.routes.js';

vi.mock('../../config.js', async (original) => {
  const module = await original<typeof import('../../config.js')>();
  return { ...module, config: { ...module.config, PANEL_PUBLIC_IP: '127.0.0.1' } };
});

vi.mock('../../lib/infra/redis.js', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]), del: vi.fn().mockResolvedValue(0),
    mget: vi.fn().mockImplementation(async (...keys: string[]) => keys.map(() => null)),
  },
}));
vi.mock('bullmq', async (original) => ({
  ...(await original<typeof import('bullmq')>()),
  Queue: class { async add() {} },
}));

const app = Fastify({ logger: false });
const originalPanelUrl = config.PUBLIC_URL;
let operator: string;

beforeAll(async () => {
  await app.register(cookie);
  await app.register(jwt, { secret: randomUUID(), cookie: { cookieName: 'iceslab_auth', signed: false } });
  app.addHook('preHandler', enforceScopes);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return reply.send(err);
  });
  await app.register(nodesRoutes);
});

beforeEach(async () => {
  config.PUBLIC_URL = 'http://panel.example.test';
  await cleanDatabase();
  const admin = await prisma.adminUser.create({ data: { username: 'local-admin', passwordHash: 'fixture' } });
  operator = app.jwt.sign({ sub: admin.id, role: admin.role, jti: randomUUID(), iatMs: Date.now() });
});

afterAll(async () => {
  config.PUBLIC_URL = originalPanelUrl;
  await app.close();
  await prisma.$disconnect();
});

const session = () => ({ authorization: `Bearer ${operator}` });
const cookieSession = () => ({ cookie: `iceslab_auth=${operator}` });
const nodeUrl = (id: string) => `/api/nodes/${id}`;

async function apiKey(scopes: string[]) {
  const token = `icp_${randomUUID()}`;
  await prisma.apiToken.create({ data: {
    name: 'fixture-automation', tokenHash: createHash('sha256').update(token).digest('hex'),
    scopes, lastUsedAt: new Date(),
  } });
  return { authorization: `Bearer ${token}` };
}

async function create(name = 'file-node') {
  const res = await app.inject({
    method: 'POST', url: '/api/nodes', headers: session(),
    payload: { name, address: name + '.example.test', protocol: 'xray' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string; payload: string; bootstrap: { token: string; payloadDownloadAvailable?: true } }>();
}

async function issue(id: string, headers = session()) {
  const res = await app.inject({ method: 'POST', url: nodeUrl(id) + '/bootstrap', headers });
  expect(res.statusCode).toBe(201);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<{ token: string; expiresAt: string; command: string; payloadOnly: boolean; payloadDownloadAvailable?: true }>();
}

function download(id: string, token: string, headers: Record<string, string> = session()) {
  return app.inject({ method: 'POST', url: nodeUrl(id) + '/bootstrap/payload', headers, payload: { token } });
}

it('authorizes the node-bound file once, including the panel cookie session', async () => {
  const created = await create();
  const other = await create('other-node');
  const original = decodeNodePayload(created.payload);
  expect(created.bootstrap.payloadDownloadAvailable).toBeUndefined();
  const startedAt = Date.now();
  const file = await issue(created.id);
  expect(file.payloadDownloadAvailable).toBe(true);
  expect(file.payloadOnly).toBe(true);
  expect(file.command.includes('--payload-file')).toBe(true);
  expect(file.command.includes(file.token)).toBe(false);
  expect(Date.parse(file.expiresAt) - startedAt).toBeGreaterThanOrEqual(15 * 60_000);
  expect(await prisma.nodeBootstrapToken.count({ where: { token: file.token } })).toBe(0);

  expect((await download(created.id, file.token, {})).statusCode).toBe(401);
  expect((await download(created.id, file.token, await apiKey(['nodes:read']))).statusCode).toBe(403);
  expect((await download(created.id, file.token, await apiKey(['nodes:write']))).statusCode).toBe(403);
  expect((await issue(created.id, await apiKey(['nodes:write']))).payloadDownloadAvailable).toBeUndefined();
  expect((await download(other.id, file.token)).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/internal/bootstrap/' + file.token })).statusCode).toBe(400);
  expect((await app.inject({ url: nodeUrl(created.id) + '/bootstrap/payload', headers: session() })).statusCode).toBe(404);
  const form = await app.inject({
    method: 'POST', url: nodeUrl(created.id) + '/bootstrap/payload',
    headers: { ...cookieSession(), 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'token=' + file.token,
  });
  expect(form.statusCode).toBe(415);

  const attempts = await Promise.all([download(created.id, file.token, cookieSession()), download(created.id, file.token)]);
  expect(attempts.map(a => a.statusCode).sort()).toEqual([200, 410]);
  const response = attempts.find(a => a.statusCode === 200)!;
  expect(response.headers['content-type']).toContain('text/plain');
  expect(response.headers['content-disposition']).toBe('attachment; filename="iceslab-node.payload"');
  expect(response.headers['cache-control']).toBe('no-store');
  const fetched = decodeNodePayload(response.body);
  expect(fetched.nodeId === original.nodeId).toBe(true);
  expect(fetched.panelClientFingerprint === original.panelClientFingerprint).toBe(true);
  expect(fetched.heartbeatToken === original.heartbeatToken).toBe(true);
  expect(fetched.nodeCertPem === original.nodeCertPem).toBe(false);
  expect((await download(created.id, file.token)).json().error).toBe('CONSUMED');
});

it('distinguishes expired, changed and deleted nodes without minting a file', async () => {
  const created = await create();
  const file = await issue(created.id);
  await prisma.nodeBootstrapToken.updateMany({
    where: { nodeId: created.id, token: { startsWith: 'bf#' } },
    data: { expiresAt: new Date(0) },
  });
  const expired = await download(created.id, file.token);
  expect(expired.statusCode).toBe(410);
  expect(expired.json().error).toBe('EXPIRED');

  const stale = await issue(created.id);
  await prisma.node.update({ where: { id: created.id }, data: { coreVersion: '26.3.27', status: 'online' } });
  const changed = await app.inject({
    method: 'PUT', url: nodeUrl(created.id), headers: session(), payload: { address: 'moved.example.test' },
  });
  expect(changed.statusCode).toBe(200);
  const refusal = await download(created.id, stale.token);
  expect(refusal.statusCode).toBe(409);
  expect(refusal.json().error).toBe('BOOTSTRAP_CONFIG_CHANGED');
  expect((await download(created.id, stale.token)).json().error).toBe('BOOTSTRAP_CONFIG_CHANGED');

  const fresh = await issue(created.id);
  const res = await download(created.id, fresh.token);
  expect(res.statusCode).toBe(200);
  const cert = decodeNodePayload(res.body);
  expect(cert.nodeId === created.id).toBe(true);

  const unusable = await issue(created.id);
  expect((await app.inject({ method: 'DELETE', url: nodeUrl(created.id), headers: session() })).statusCode).toBe(204);
  expect((await download(created.id, unusable.token)).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: nodeUrl(created.id) + '/bootstrap', headers: session() })).statusCode).toBe(404);
});

it('survives health writes and refuses an unlisted core version without consuming the file ticket', async () => {
  const { id } = await create();
  const healthy = await issue(id);
  await prisma.node.update({ where: { id }, data: { status: 'online', coreVersion: '26.3.27' } });
  expect((await download(id, healthy.token)).statusCode).toBe(200);

  await prisma.node.update({ where: { id }, data: { coreVersions: { xray: '0.0.0' } } });
  const invalid = await issue(id);
  for (let i = 0; i < 2; i++) {
    const response = await download(id, invalid.token);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('CORE_VERSION_NOT_LISTED');
  }
  expect(await prisma.nodeBootstrapToken.count({
    where: { nodeId: id, consumedAt: null, token: { startsWith: 'bf#' } },
  })).toBe(1);
});

it('preserves HTTPS bootstrap and does not advertise file download there', async () => {
  config.PUBLIC_URL = 'https://panel.example.test';
  const { id } = await create();
  const bootstrap = await issue(id);
  expect(bootstrap.payloadOnly).toBe(false);
  expect(bootstrap.payloadDownloadAvailable).toBeUndefined();
  expect(bootstrap.command.includes('--bootstrap')).toBe(true);
  expect((await download(id, bootstrap.token)).statusCode).toBe(400);
  const url = '/api/internal/bootstrap/' + bootstrap.token;
  expect((await app.inject({ url })).statusCode).toBe(200);
  expect((await app.inject({ url })).statusCode).toBe(410);
});

it('rejects Telegram WEB as a node protocol or intended engine', async () => {
  for (const field of [{ protocol: 'telegramweb' }, { intendedEngines: ['telegramweb'] }]) {
    const res = await app.inject({
      method: 'POST', url: '/api/nodes', headers: session(),
      payload: { name: 'unsupported-web', address: 'fixture.example.test', ...field },
    });
    expect(res.statusCode).toBe(400);
  }
  expect(await prisma.node.count()).toBe(0);
});
