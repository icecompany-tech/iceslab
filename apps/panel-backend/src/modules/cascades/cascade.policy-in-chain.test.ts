import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { ROOT, datFile, domain, site } from '../../../tests/helpers/geo-dat.js';
import { applyInboundsRequestForNode } from '../inbounds/inbounds.queue.js';
import { getChainForNode } from './cascade.service.js';
import { chainSocksPort } from './chain.ports.js';
import { ensureBuiltinSets, ingestGeoFile } from '../geo-sets/geo-sets.store.js';
import { nodeGeoFor } from '../geo-sets/geo-push.js';
import { geoTagList, geositeRuleSet, parseGeoDat } from '../geo-sets/geo-dat.js';
import { createHash } from 'node:crypto';

/**
 * Phase 9.3: the route policies move from xray's entry into the chain process
 * at the entry, gated on the socks user each profile is handed over as. Plus
 * the owner's ENTRY POLICY of 24.09, for the users who cannot pick one.
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

async function makeCascade(entry: string, exit: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  return app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: `ru-out-${seq}`,
      enabled: true,
      positions: [{ position: 0, nodeIds: [entry], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ countryCode: 'NL', nodeIds: [exit] }],
      ...extra,
    },
  });
}

const NO_ADS = {
  name: 'no-ads',
  ordinal: 1,
  directDomains: ['domain:gosuslugi.ru'],
  blockDomains: ['geosite:category-ads-all', 'ads.example'],
};

type Rule = Record<string, unknown>;

describe('the route policies, drawn by the chain at the entry', () => {
  it('go to the chain and leave xray in ONE push; the legacy drawing keeps them', async () => {
    await prisma.routePolicy.create({ data: NO_ADS });
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    expect((await makeCascade(entry, exit)).statusCode).toBe(201);

    const req = (await applyInboundsRequestForNode(entry))!;
    const config = req.chain!.config as {
      inbounds: { type: string; users?: { username: string }[] }[];
      route: { rules: Rule[]; rule_set?: Rule[] };
    };

    // The chain: one socks user per profile, the policy under p1.
    const socks = config.inbounds.filter((i) => i.type === 'socks');
    expect(socks.every((i) => i.users!.map((u) => u.username).join() === 'p0,p1')).toBe(true);
    expect(config.route.rules).toContainEqual({
      auth_user: ['p1'],
      domain_suffix: ['ads.example'],
      rule_set: ['geo-geosite-category-ads-all'],
      action: 'reject',
      method: 'drop',
    });
    expect(config.route.rules).toContainEqual({
      auth_user: ['p1'],
      domain: ['gosuslugi.ru'],
      domain_suffix: ['.gosuslugi.ru'],
      action: 'route',
      outbound: 'direct',
    });
    expect(config.route.rule_set).toEqual([
      {
        type: 'local',
        tag: 'geo-geosite-category-ads-all',
        format: 'source',
        path: '/etc/iceslab-node/geo/iceslab-geosite.category-ads-all.json',
      },
    ]);

    // xray's entry under handover: not one domain rule, in the same request.
    // (The legacy drawing for an agent without a chain keeps them; it rides on
    // the node's xray inbound, which this fixture has none of, and
    // cascade.chain-handover.test.ts holds it side by side with this one.)
    expect(JSON.stringify(req.chain!.userCore)).not.toContain('"domain"');
    expect(JSON.stringify(req.chain!.userCore)).toContain('cascade-link-out-chain-d1-p1');
  });

  it('are not drawn on a transit or an exit', async () => {
    await prisma.routePolicy.create({ data: NO_ADS });
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await makeCascade(entry, exit);
    const cfg = (await getChainForNode(exit))!.config as { route: { rules: Rule[]; rule_set?: unknown } };
    expect(cfg.route.rules.some((r) => 'auth_user' in r)).toBe(false);
    expect(cfg.route.rule_set).toBeUndefined();
  });
});

describe('the entry policy of a cascade', () => {
  async function hysteriaEntry(extra: Record<string, unknown> = {}) {
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    const res = await makeCascade(entry, exit, extra);
    expect(res.statusCode, res.body).toBe(201);
    const c = JSON.parse(res.body) as { id: string; entryPolicy: unknown };
    await prisma.cascadePosition.updateMany({ where: { cascadeId: c.id, position: 0 }, data: { entryProtocol: 'hysteria' } });
    return { entry, cascade: c };
  }
  const handoffUser = async (entry: string) => {
    const uc = (await getChainForNode(entry))!.userCore as { engine: string; socks: { port: number; username: string } };
    expect(uc.engine).toBe('hysteria');
    expect(uc.socks.port).toBe(chainSocksPort(0));
    return uc.socks.username;
  };
  const put = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/cascades/${id}`, headers: auth(), payload });

  it('hands every hysteria user over as the policy user; none is the plain p0', async () => {
    const policy = await prisma.routePolicy.create({ data: NO_ADS, select: { id: true } });
    const { entry, cascade } = await hysteriaEntry({ entryPolicyId: policy.id });
    expect(cascade.entryPolicy).toEqual({ id: policy.id, name: 'no-ads', ordinal: 1 });
    expect(await handoffUser(entry)).toBe('p1');
    // And the chain draws that policy for p1, the same block as for xray users.
    const cfg = (await getChainForNode(entry))!.config as { route: { rules: Rule[] } };
    expect(cfg.route.rules.some((r) => (r.auth_user as string[] | undefined)?.[0] === 'p1' && r.action === 'reject')).toBe(true);

    // Absent key: no edit. null: cleared.
    expect(JSON.parse((await put(cascade.id, { autoProfile: false })).body).entryPolicy).toEqual({
      id: policy.id,
      name: 'no-ads',
      ordinal: 1,
    });
    expect(await handoffUser(entry)).toBe('p1');
    expect(JSON.parse((await put(cascade.id, { entryPolicyId: null })).body).entryPolicy).toBeNull();
    expect(await handoffUser(entry)).toBe('p0');
  });

  it('refuses a policy that is not there, on create and on update', async () => {
    const missing = '00000000-0000-4000-8000-00000000abcd';
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    const bad = await makeCascade(entry, exit, { entryPolicyId: missing });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body)).toMatchObject({ error: 'ENTRY_POLICY_NOT_FOUND', policyId: missing });

    const ok = JSON.parse((await makeCascade(entry, exit)).body) as { id: string };
    const res = await put(ok.id, { entryPolicyId: missing });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('ENTRY_POLICY_NOT_FOUND');
  });

  it('keeps its policy from being deleted, naming the cascade', async () => {
    const policy = await prisma.routePolicy.create({ data: NO_ADS, select: { id: true } });
    const { cascade } = await hysteriaEntry({ entryPolicyId: policy.id });
    const res = await app.inject({ method: 'DELETE', url: `/api/route-policies/${policy.id}`, headers: auth() });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ROUTE_POLICY_IN_USE');
    expect(body.cascades).toEqual([{ id: cascade.id, name: expect.stringMatching(/^ru-out-/) }]);
    expect(await prisma.routePolicy.count()).toBe(1);
  });
});

describe('the chain rule-sets in the geo push', () => {
  it('reach the entry from the pinned version, and not the exit', async () => {
    await ensureBuiltinSets();
    const geosite = await prisma.geoSet.findUniqueOrThrow({ where: { name: 'geosite' }, select: { id: true } });
    const dat = datFile(site('CATEGORY-ADS-ALL', domain(ROOT, 'doubleclick.net')));
    await ingestGeoFile(geosite.id, { bytes: dat });
    await prisma.routePolicy.create({ data: NO_ADS });
    const entry = await makeNode('ru-entry');
    const exit = await makeNode('nl-exit');
    await makeCascade(entry, exit);

    const files = (await nodeGeoFor(entry, { pinMissing: false }))!.files;
    const chainFile = files.find((f) => f.reader === 'chain')!;
    const json = Buffer.from(JSON.stringify(geositeRuleSet(dat, parseGeoDat(dat, 'geosite'), 'category-ads-all')));
    expect(chainFile).toMatchObject({
      name: 'iceslab-geosite.category-ads-all.json',
      sha256: createHash('sha256').update(json).digest('hex'),
      setName: 'geosite',
    });
    expect(files.map((f) => f.name)).toEqual(['geosite.dat', 'iceslab-geosite.category-ads-all.json']);
    expect(geoTagList(parseGeoDat(dat, 'geosite'))[0]!.name).toBe('category-ads-all');

    // The exit carries no route policy: it gets nothing of the set.
    expect(await nodeGeoFor(exit, { pinMissing: false })).toBeNull();

    // And the rollout plan names the file beside the .dat, without saying
    // the rule-set restarts anything.
    const plan = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/geo-sets/${geosite.id}/rollout-plan`, headers: auth() })).body,
    );
    expect(plan.nodes).toEqual([
      expect.objectContaining({
        id: entry,
        filesToSend: ['geosite.dat', 'iceslab-geosite.category-ads-all.json'],
      }),
    ]);
  });
});
