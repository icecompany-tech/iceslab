import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { getChainForNode } from './cascade.service.js';
import { chainTagsFor } from '../geo-sets/geo-push.js';
import type { GeoUseSite } from '../geo-sets/geo-refs.js';

/**
 * E53: the node policy of a cascade exit, as the push hands it to the exit's
 * chain. The translation and the live run are in chain.exit-policy.test.ts;
 * this is the panel's side: which node gets it, with which WARP, and when the
 * push refuses.
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

/** ru -> nl, and a policy on nl with a warp rule and a block rule. */
async function stand(opts: { warpAccount: object | null }) {
  const ru = await makeNode('ru');
  const nl = await makeNode('nl');
  const c = await app.inject({
    method: 'POST',
    url: '/api/cascades',
    headers: auth(),
    payload: {
      name: 'test',
      enabled: true,
      positions: [{ position: 0, nodeIds: [ru], entryProtocol: 'xray', linkProtocol: 'vless' }],
      directions: [{ countryCode: 'NL', nodeIds: [nl] }],
    },
  });
  expect(c.statusCode, c.body).toBe(201);
  const policy = await prisma.nodePolicy.create({
    data: {
      name: 'warp-test',
      rules: {
        create: [
          { position: 0, matchDomain: ['domain:cloudflare.com'], actionKind: 'warp' },
          { position: 1, matchIp: ['198.51.100.0/24'], actionKind: 'block' },
        ],
      },
    },
  });
  await prisma.node.update({
    where: { id: nl },
    data: {
      policyId: policy.id,
      warpEnabled: true,
      ...(opts.warpAccount ? { warpAccount: opts.warpAccount } : {}),
    },
  });
  return { ru, nl };
}

describe('the exit chain carries the node policy of its node', () => {
  it('routes the policy domain into WARP from the exit, with the account the node holds', async () => {
    const { ru, nl } = await stand({
      warpAccount: {
        secretKey: Buffer.from('iceslab-warp-fixture-key-0000000').toString('base64'),
        address: ['172.16.0.2', '2606:4700:110:8a36::1'],
        endpoint: 'engage.cloudflareclient.com:2408',
        reserved: [7, 8, 9],
      },
    });
    const chain = await getChainForNode(nl);
    const cfg = chain!.config as {
      endpoints?: Record<string, unknown>[];
      route: { rules: Record<string, unknown>[]; final?: string };
    };
    expect(cfg.route.rules).toContainEqual({
      domain: ['cloudflare.com'],
      domain_suffix: ['.cloudflare.com'],
      action: 'route',
      outbound: 'warp',
    });
    expect(cfg.route.rules).toContainEqual({ ip_cidr: ['198.51.100.0/24'], action: 'reject', method: 'drop' });
    expect(cfg.route.final).toBe('direct');
    expect(cfg.endpoints).toEqual([
      {
        type: 'wireguard',
        tag: 'warp',
        system: false,
        mtu: 1280,
        address: ['172.16.0.2/32', '2606:4700:110:8a36::1/128'],
        private_key: Buffer.from('iceslab-warp-fixture-key-0000000').toString('base64'),
        peers: [
          {
            address: 'engage.cloudflareclient.com',
            port: 2408,
            public_key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
            allowed_ips: ['0.0.0.0/0', '::/0'],
            reserved: [7, 8, 9],
          },
        ],
      },
    ]);
    // The entry's chain is not the exit's: no policy, no WARP there.
    const entry = (await getChainForNode(ru))!.config as { endpoints?: unknown; route: { rules: Record<string, unknown>[] } };
    expect(entry.endpoints).toBeUndefined();
    expect(entry.route.rules.some((r) => r.outbound === 'warp')).toBe(false);
  });

  it('refuses the push out loud when the policy routes into WARP and the node holds no usable account', async () => {
    const { nl } = await stand({ warpAccount: null });
    await expect(getChainForNode(nl)).rejects.toThrow(/WARP/);
  });

  it('lays the exit\'s geo lists out for its chain, and not for a node that is no exit', () => {
    const site = (field: 'domain' | 'ip', set: string, tag: string): GeoUseSite => ({
      ref: { set, tag, field } as GeoUseSite['ref'],
      owner: { kind: 'node-policy', id: 'p', name: 'p' },
      nodeIds: ['n'],
    });
    const sites = [site('domain', 'geosite', 'category-ads-all'), site('ip', 'geoip', 'ru')];
    expect([...chainTagsFor('n', sites, true)]).toEqual([
      ['geosite', ['category-ads-all']],
      ['geoip', ['ru']],
    ]);
    expect(chainTagsFor('n', sites, false).size).toBe(0);
  });
});
