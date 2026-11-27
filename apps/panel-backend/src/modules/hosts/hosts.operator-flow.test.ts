import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { config } from '../../config.js';
import { prisma } from '../../prisma.js';
import { enforceScopes } from '../auth/scope.hook.js';
import { applyInboundsRequestForNode } from '../inbounds/inbounds.queue.js';
import { profilesRoutes } from '../profiles/profiles.routes.js';
import { squadsRoutes } from '../squads/squads.routes.js';
import { subscriptionTemplatesRoutes } from '../subscription-templates/templates.routes.js';
import { invalidateTemplateCache } from '../subscription-templates/templates.service.js';
import { registerBindingsCacheBust } from '../subscription/subscription.bindings-cache.js';
import { subscriptionRoutes } from '../subscription/subscription.routes.js';
import { bindingsReachedBySquads } from '../users/user-reach.js';
import { hostsRoutes } from './hosts.routes.js';

vi.mock('../../lib/infra/redis.js', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]), del: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
  },
}));
vi.mock('bullmq', async (original) => ({
  ...(await original<typeof import('bullmq')>()), Queue: class {},
}));
const app = Fastify({ logger: false });
const hostApi = '/api/hosts';
let headers: { authorization: string };

beforeAll(async () => {
  registerBindingsCacheBust();
  app.addHook('preHandler', enforceScopes);
  for (const routes of [profilesRoutes, hostsRoutes, squadsRoutes, subscriptionTemplatesRoutes, subscriptionRoutes]) {
    await app.register(routes);
  }
});
beforeEach(async () => {
  await cleanDatabase();
  invalidateTemplateCache();
  const token = `icp_${randomUUID()}`;
  headers = { authorization: `Bearer ${token}` };
  await prisma.apiToken.create({ data: {
    name: 'Local operator', tokenHash: createHash('sha256').update(token).digest('hex'),
    scopes: ['profiles:write', 'hosts:read', 'hosts:write', 'bindings:write', 'squads:read', 'squads:write', 'subscription-templates:write'],
    lastUsedAt: new Date(),
  } });
});
afterAll(async () => {
  await app.close();
  await cleanDatabase();
  await prisma.$disconnect();
});

async function api<T = { id: string; bindingId: string; priority: number }>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, status: number, payload?: object,
): Promise<T> {
  const res = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  if (res.statusCode !== status) {
    let code: string | undefined;
    try {
      code = res.json().error;
    } catch {
      // A non-JSON error has no application code to report.
    }
    throw new Error(`${method} ${url.replace(/[0-9a-f-]{36}/gi, ':id')} expected ${status}, received ${res.statusCode} ${code ?? ''}`);
  }
  return status === 204 ? undefined as T : res.json<T>();
}

async function base() {
  const node = await prisma.node.create({ data: {
    name: 'host-audit-node', address: '192.0.2.50', status: 'online', heartbeatSecret: Buffer.alloc(32),
  } });
  const profile = await api('POST', '/api/profiles', 201, {
    name: 'host-audit-profile', protocol: 'xray',
    config: { security: 'none', subprotocol: 'vless', network: 'ws', path: '/fixture', flow: '' },
  });
  return { nodeId: node.id, profileId: profile.id };
}

const listHosts = () => api<{ hosts: { id: string; bindingId: string; priority: number }[] }>('GET', hostApi, 200);
const reorder = (hostIds: string[]) => api<{ hosts: { id: string; priority: number }[] }>('PUT', hostApi + '/reorder', 200, { hostIds });

it('checks create, overrides, grants, visibility and delete on a shared binding', async () => {
  const ctx = await base();
  const p = 18001;
  const a = await api('POST', hostApi, 201, { ...ctx, port: p, remark: 'A', addressOverride: 'a.invalid' });
  const b = await api('POST', hostApi, 201, { ...ctx, port: p, remark: 'B', addressOverride: 'b.invalid' });
  expect(b.bindingId === a.bindingId).toBe(true);
  expect(await prisma.profileNodeBinding.count({ where: { nodeId: ctx.nodeId } })).toBe(1);
  expect(await prisma.host.count({ where: { bindingId: a.bindingId } })).toBe(2);
  const squad = await api<{ id: string }>('POST', '/api/squads', 201, { name: 'Audit only' });
  const user = await prisma.user.create({ data: {
    shortId: 'hostAuditFixture', username: 'host-audit-fixture',
    subscriptionToken: randomUUID().replaceAll('-', ''), xrayUuid: randomUUID(),
    hysteriaPassword: 'fixture', amneziawgPrivateKey: 'fixture', amneziawgPublicKey: 'fixture',
    naivePassword: 'fixture', enabledProtocols: ['xray'],
  } });
  await prisma.groupMember.create({ data: { groupId: squad.id, userId: user.id } });
  const sub = async (query = '?format=raw') => {
    const out = await app.inject({ url: `${config.SUBSCRIPTION_PATH_PREFIX}/${user.subscriptionToken}${query}` });
    expect(out.statusCode).toBe(200);
    return out.body;
  };
  const raw = async () => (await sub()).split('\n').filter(Boolean).map((line) => {
    const url = new URL(line);
    return { name: decodeURIComponent(url.hash.slice(1)), address: url.hostname, port: Number(url.port) };
  });
  const names = async () => (await raw()).map((r) => r.name);
  const mihomo = async (query: string) => ((parseYaml(await sub(query)) as { proxies?: { name: string }[] }).proxies ?? []).map((r) => r.name);
  const nodeRender = () => applyInboundsRequestForNode(ctx.nodeId);
  const state = await nodeRender();
  expect(state?.inbounds.length).toBe(1);
  expect(state?.inbounds[0]?.port).toBe(p);
  const renderUnchanged = async () => expect(JSON.stringify(await nodeRender()) === JSON.stringify(state)).toBe(true);
  const reached = async () => (await bindingsReachedBySquads([squad.id], { nodeId: ctx.nodeId })).get(squad.id)?.length ?? 0;
  const squadUrl = `/api/squads/${squad.id}`;
  const grant = async (hostIds: string[]) => {
    await api('GET', squadUrl, 200);
    await api('PUT', squadUrl, 200, { hostIds, profileIds: [ctx.profileId] });
    const current = await api<{ hostIds: string[] }>('GET', squadUrl, 200);
    expect(current.hostIds.length).toBe(hostIds.length);
    for (const value of hostIds) expect(current.hostIds.includes(value)).toBe(true);
  };
  const editA = (data: object) => api('PUT', `${hostApi}/${a.id}`, 200, data);
  expect(await names()).toEqual([]);
  expect(await reached()).toBe(0);
  await grant([a.id]);
  expect(await raw()).toEqual([{ name: 'A', address: 'a.invalid', port: p }]);
  expect(await reached()).toBe(1);
  await renderUnchanged();

  await editA({ addressOverride: 'new-a.invalid', portOverride: 18443 });
  expect(await raw()).toEqual([{ name: 'A', address: 'new-a.invalid', port: 18443 }]);
  expect(await prisma.profileNodeBinding.findUnique({ where: { id: a.bindingId }, select: { port: true } })).toEqual({ port: p });
  await renderUnchanged();

  await api('POST', '/api/subscription-templates', 201, {
    type: 'mihomo', name: 'audit-hidden', body: 'iceslab:\n  includeHiddenHosts: true\nproxies:\nproxy-groups:\n  - name: S\n    type: select\nrules:\n  - MATCH,S\n',
  });
  await editA({ disableForFormats: ['raw'] });
  expect(await names()).toEqual([]);
  expect(await mihomo('?format=mihomo')).toEqual(['A-xray']);
  expect(await reached()).toBe(1);
  await renderUnchanged();
  await editA({ disableForFormats: [] });

  await editA({ isHidden: true });
  expect(await names()).toEqual([]);
  expect(await mihomo('?format=mihomo')).toEqual([]);
  expect(await mihomo('?format=mihomo&template=audit-hidden')).toEqual(['A-xray']);
  expect(await reached()).toBe(1);
  await renderUnchanged();
  await editA({ enabled: false });
  expect(await names()).toEqual([]);
  expect(await mihomo('?format=mihomo&template=audit-hidden')).toEqual([]);
  expect(await reached()).toBe(0);
  await renderUnchanged();

  await editA({ enabled: true, isHidden: false });
  await grant([a.id, b.id]);
  expect(await names()).toEqual(['A', 'B']);
  const order = await reorder([b.id, a.id]);
  expect(order.hosts.map((h) => h.priority)).toEqual([0, 1]);
  expect(await names()).toEqual(['B', 'A']);
  await renderUnchanged();

  const bindingUrl = `/api/bindings/${a.bindingId}`;
  await api('PUT', bindingUrl, 200, { enabled: false });
  expect(await names()).toEqual([]);
  expect((await nodeRender())?.inbounds.length).toBe(0);
  await api('PUT', bindingUrl, 200, { enabled: true });
  expect(await names()).toEqual(['B', 'A']);
  await renderUnchanged();

  await api('DELETE', `${hostApi}/${a.id}`, 204);
  await api('GET', `${hostApi}/${a.id}`, 404);
  expect(await names()).toEqual(['B']);
  expect(await reached()).toBe(1);
  const after = await api<{ hostIds: string[]; profileIds: string[] }>('GET', squadUrl, 200);
  expect(after.hostIds.length === 1 && after.hostIds[0] === b.id && after.profileIds[0] === ctx.profileId).toBe(true);
  expect(await prisma.host.count({ where: { bindingId: b.bindingId } })).toBe(1);
  await renderUnchanged();
});

it('returns one common order after moving a host across bindings', async () => {
  const ctx = await base();
  await api('POST', hostApi, 201, { ...ctx, port: 18001, remark: 'First' });
  await api('POST', hostApi, 201, { ...ctx, port: 18001, remark: 'Sibling' });
  await api('POST', hostApi, 201, { ...ctx, port: 18002, remark: 'Other binding' });
  const initial = (await listHosts()).hosts;
  const firstBinding = initial[0]!.bindingId;
  const candidate = initial.find((host) => host.bindingId !== firstBinding)!;
  const desired = [candidate.id, ...initial.filter((host) => host.id !== candidate.id).map((host) => host.id)];
  const write = await reorder(desired);
  expect(write.hosts.every((host, i) => host.id === desired[i] && host.priority === i)).toBe(true);
  const refreshed = (await listHosts()).hosts;
  expect(refreshed.every((host, i) => host.id === desired[i])).toBe(true);
  expect(refreshed.map((host) => host.priority)).toEqual([0, 1, 2]);
});
