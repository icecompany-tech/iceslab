import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { ROOT, datFile, domain, site } from '../../../tests/helpers/geo-dat.js';
import { GEO_BUILTIN } from '@iceslab/shared';
import { ingestGeoFile } from './geo-sets.store.js';
import { geoSetsQueue } from './geo-sets.queue.js';

/**
 * Phase 9.1v: /api/geo-sets as geo-contract.md section 5 draws it. The push
 * that carries a rollout to a node is phase 9.2; here a rollout moves pins.
 */
let app: FastifyInstance;
let token: string;
let queued: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  // Nothing reaches the real queue: the dev backend's worker shares this
  // Redis and would pick a test's job up against the dev database.
  queued = vi.spyOn(geoSetsQueue, 'add').mockResolvedValue({} as never);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await geoSetsQueue.close();
  await prisma.$disconnect();
  await closeRedis();
});

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

const lists = datFile(
  site('ADS', domain(ROOT, 'a.com')),
  site('ADULT', domain(ROOT, 'b.com')),
  site('CATEGORY-ADS', domain(ROOT, 'c.com')),
  site('RU', domain(ROOT, 'd.ru')),
);

/** An operator's set with a verified version, as an upload leaves it. */
async function verifiedSet(name = 'mylist', bytes = lists) {
  const s = await prisma.geoSet.create({
    data: { name, kind: 'geosite', sourceType: 'upload', filename: `${name}.dat` },
    select: { id: true },
  });
  const out = await ingestGeoFile(s.id, { bytes });
  if (out.status !== 'verified') throw new Error('fixture');
  return s.id;
}

async function node(name: string, extra: { policyId?: string; cores?: object; dns?: object } = {}) {
  const n = await prisma.node.create({
    data: {
      name,
      address: `${name}.example.com:1337`,
      protocol: 'xray',
      heartbeatSecret: randomBytes(32),
      ...(extra.policyId ? { policyId: extra.policyId } : {}),
      ...(extra.cores ? { cores: extra.cores } : {}),
      ...(extra.dns ? { dns: extra.dns } : {}),
    },
    select: { id: true },
  });
  return n.id;
}

async function policy(name: string, domains: string[], ips: string[] = []) {
  const p = await prisma.nodePolicy.create({
    data: {
      name,
      rules: { create: [{ position: 0, matchDomain: domains, matchIp: ips, matchProtocol: [], actionKind: 'block' }] },
    },
    select: { id: true },
  });
  return p.id;
}

describe('the list', () => {
  it('has the two built-in sets on a fresh panel, waiting for their pinned release', async () => {
    const { status, body } = await call('GET', '/api/geo-sets');
    expect(status).toBe(200);
    expect(body.geoSets.map((s: { name: string; source: unknown; status: string; nodes: unknown }) => [s.name, s.source, s.status, s.nodes])).toEqual([
      ['geoip', { type: 'builtin', tag: GEO_BUILTIN.geoip.tag }, 'checking', { total: 0, behind: 0 }],
      ['geosite', { type: 'builtin', tag: GEO_BUILTIN.geosite.tag }, 'checking', { total: 0, behind: 0 }],
    ]);
  });

  it('counts the rule entries naming a set and the nodes they reach, none of them pinned yet', async () => {
    const id = await verifiedSet();
    const p = await policy('no-ads', ['ext:mylist:ads', 'ext:mylist:adult@x', 'example.com']);
    await node('ru-01', { policyId: p });
    await node('ru-02', { dns: { servers: [{ address: '1.1.1.1', domains: ['ext-domain:mylist:ru'], expectIps: [] }] } });
    const { body } = await call('GET', `/api/geo-sets/${id}`);
    expect(body).toMatchObject({
      name: 'mylist',
      source: { type: 'upload', filename: 'mylist.dat' },
      status: 'verified',
      current: { tagCount: 4 },
      usedByRules: 3,
      nodes: { total: 2, behind: 2 },
    });
  });
});

describe('creating from a URL', () => {
  const create = (over: Record<string, unknown> = {}, source: Record<string, unknown> = {}) =>
    call('POST', '/api/geo-sets', {
      name: 'lists',
      kind: 'geosite',
      source: { type: 'url', url: 'https://example.com/lists.dat', sha256Source: 'sidecar', ...source },
      ...over,
    });

  it('answers checking at once and queues the fetch', async () => {
    const { status, body } = await create();
    expect(status).toBe(202);
    expect(body).toMatchObject({
      status: 'checking',
      current: null,
      source: { type: 'url', url: 'https://example.com/lists.dat', sha256Source: 'sidecar', refreshHours: 24 },
    });
    expect(queued).toHaveBeenCalledWith('fetchUrl', { setId: body.id }, { jobId: `url-${body.id}` });
  });

  it.each([
    [{ name: 'My.List' }, {}, 'name'],
    [{ name: 'geosite' }, {}, 'name-reserved'],
    [{}, { url: 'ftp://example.com/x.dat' }, 'url'],
    [{}, { sha256Source: 'manual' }, 'sha256'],
  ])('refuses %j %j with reason %s', async (over, source, reason) => {
    const { status, body } = await create(over, source);
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'GEO_SET_INVALID', reason });
  });

  it('refuses a name that is taken', async () => {
    await create();
    expect((await create()).body).toMatchObject({ error: 'GEO_SET_NAME_TAKEN' });
  });
});

describe('a set rules name cannot be deleted or renamed, and the refusal says where', () => {
  it('node policy, route policy, node DNS', async () => {
    const id = await verifiedSet();
    const p = await policy('no-ads', ['ext:mylist:ads']);
    const rp = await prisma.routePolicy.create({
      data: { name: 'ad-split', ordinal: 1, directDomains: [], blockDomains: ['ext:mylist:ads'] },
      select: { id: true },
    });
    const dnsNode = await node('ru-02', { dns: { servers: [{ address: '1.1.1.1', domains: [], expectIps: ['ext-ip:mylist:ru'] }] } });

    const del = await call('DELETE', `/api/geo-sets/${id}`);
    expect(del.status).toBe(409);
    expect(del.body).toMatchObject({ error: 'GEO_SET_IN_USE' });
    expect(del.body.uses).toEqual([
      { kind: 'node-dns', id: dnsNode, name: 'ru-02' },
      { kind: 'node-policy', id: p, name: 'no-ads' },
      { kind: 'route-policy', id: rp.id, name: 'ad-split' },
    ]);
    expect((await call('PATCH', `/api/geo-sets/${id}`, { name: 'other' })).body).toMatchObject({ error: 'GEO_SET_IN_USE' });
  });

  it('an unused one goes, and its bytes with it', async () => {
    const id = await verifiedSet();
    expect((await call('DELETE', `/api/geo-sets/${id}`)).status).toBe(204);
    expect(await prisma.geoBlob.count()).toBe(0);
  });

  it('a built-in one never goes', async () => {
    const { body } = await call('GET', '/api/geo-sets');
    const geoip = body.geoSets.find((s: { name: string }) => s.name === 'geoip');
    expect((await call('DELETE', `/api/geo-sets/${geoip.id}`)).body).toMatchObject({ error: 'GEO_SET_BUILTIN' });
  });

  it('an uploaded one has no refresh, a built-in one no source to edit', async () => {
    const id = await verifiedSet();
    expect((await call('POST', `/api/geo-sets/${id}/refresh`)).body).toMatchObject({
      error: 'GEO_SET_INVALID',
      reason: 'source-not-editable',
    });
    const { body } = await call('GET', '/api/geo-sets');
    const geosite = body.geoSets.find((s: { name: string }) => s.name === 'geosite');
    expect((await call('PATCH', `/api/geo-sets/${geosite.id}`, { name: 'x' })).body).toMatchObject({
      reason: 'source-not-editable',
    });
  });
});

describe('tags', () => {
  it('filtered by what was typed, a prefix before a mere match, limited', async () => {
    const id = await verifiedSet();
    const { body } = await call('GET', `/api/geo-sets/${id}/tags?q=ad&limit=2`);
    expect(body).toMatchObject({ total: 3, tags: [{ name: 'ads' }, { name: 'adult' }] });
    const all = await call('GET', `/api/geo-sets/${id}/tags?q=ad`);
    expect(all.body.tags.map((t: { name: string }) => t.name)).toEqual(['ads', 'adult', 'category-ads']);
  });

  it('a set with no verified version has none to offer', async () => {
    const { body } = await call('GET', '/api/geo-sets');
    const geoip = body.geoSets.find((s: { name: string }) => s.name === 'geoip');
    expect((await call('GET', `/api/geo-sets/${geoip.id}/tags`)).body).toMatchObject({ error: 'GEO_SET_NOT_VERIFIED' });
  });
});

describe('rollout: the plan, then the pins', () => {
  it('lists every node the set reaches, what it would get and whether xray restarts', async () => {
    const id = await verifiedSet();
    const p = await policy('no-ads', ['ext:mylist:ads']);
    await node('ru-01', { policyId: p });
    await node('nl-01', {
      policyId: p,
      cores: { observedAt: new Date().toISOString(), cores: [{ name: 'tuic', engine: 'singbox', installed: true }] },
    });
    const { body } = await call('GET', `/api/geo-sets/${id}/rollout-plan`);
    expect(body).toEqual({
      version: expect.stringMatching(/^[0-9a-f]{12}$/),
      nodes: [
        { id: expect.any(String), name: 'nl-01', from: null, filesToSend: ['iceslab-mylist.dat'], restartsXray: false },
        // ru-01 never said what it runs: shown as the worse case.
        { id: expect.any(String), name: 'ru-01', from: null, filesToSend: ['iceslab-mylist.dat'], restartsXray: true },
      ],
      breaks: [],
    });
  });

  it('moves the pins of the confirmed version, and a second rollout has nothing to move', async () => {
    const id = await verifiedSet();
    const p = await policy('no-ads', ['ext:mylist:ads']);
    await node('ru-01', { policyId: p });
    const { version } = (await call('GET', `/api/geo-sets/${id}/rollout-plan`)).body;

    expect((await call('POST', `/api/geo-sets/${id}/rollout`, { version: 'aaaaaaaaaaaa' })).body).toMatchObject({
      error: 'GEO_ROLLOUT_STALE',
      current: version,
    });
    expect((await call('POST', `/api/geo-sets/${id}/rollout`, { version })).body).toEqual({ nodes: 1 });
    expect(await prisma.nodeGeoPin.count()).toBe(1);

    const again = (await call('GET', `/api/geo-sets/${id}/rollout-plan`)).body;
    expect(again.nodes[0]).toMatchObject({ from: version, filesToSend: [], restartsXray: false });
    expect((await call('GET', `/api/geo-sets/${id}`)).body.nodes).toEqual({ total: 1, behind: 0 });
    expect((await call('POST', `/api/geo-sets/${id}/rollout`, { version })).body).toEqual({ nodes: 0 });
  });

  it('a version that lacks a tag a rule names is not rolled out, and the rule is named', async () => {
    const id = await verifiedSet();
    // RU and adult@x are there, spelled as xray reads them: upper case, with
    // an attribute. Only the tag itself has to exist.
    const p = await policy('no-ads', ['ext:mylist:ads', 'ext:mylist:RU', 'ext:mylist:adult@x', 'ext:mylist:gone@x', 'ext:mylist:GONE']);
    await node('ru-01', { policyId: p });
    const plan = (await call('GET', `/api/geo-sets/${id}/rollout-plan`)).body;
    expect(plan.breaks).toEqual([
      { entry: 'ext:mylist:GONE', uses: [{ kind: 'node-policy', id: p, name: 'no-ads' }] },
      { entry: 'ext:mylist:gone@x', uses: [{ kind: 'node-policy', id: p, name: 'no-ads' }] },
    ]);
    const res = await call('POST', `/api/geo-sets/${id}/rollout`, { version: plan.version });
    expect(res.body).toMatchObject({ error: 'GEO_ROLLOUT_BREAKS', breaks: plan.breaks });
    expect(await prisma.nodeGeoPin.count()).toBe(0);
  });

  it('a route policy reaches the entries of enabled cascades, not their exits and not a disabled one', async () => {
    const id = await verifiedSet();
    await prisma.routePolicy.create({ data: { name: 'ad-split', ordinal: 1, directDomains: [], blockDomains: ['ext:mylist:ads'] } });
    const entry = await node('ru-01');
    const exit = await node('se-01');
    const offEntry = await node('ru-03');
    for (const [name, enabled, e] of [['on', true, entry], ['off', false, offEntry]] as const) {
      const c = await prisma.cascade.create({ data: { name, enabled, mode: 'chain' }, select: { id: true } });
      await prisma.cascadePosition.create({ data: { cascadeId: c.id, position: 0, entryProtocol: 'xray', nodes: { create: [{ nodeId: e }] } } });
      await prisma.cascadeDirection.create({ data: { cascadeId: c.id, tag: 1, nodes: { create: [{ nodeId: exit }] } } });
    }
    const plan = (await call('GET', `/api/geo-sets/${id}/rollout-plan`)).body;
    expect(plan.nodes.map((n: { name: string }) => n.name)).toEqual(['ru-01']);
  });
});
