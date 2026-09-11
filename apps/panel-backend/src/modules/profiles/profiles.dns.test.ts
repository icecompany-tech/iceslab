import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { fetchEnabledInbounds } from '../inbounds/inbounds.queue.js';

/**
 * Э3 piece F on the panel side: the profile names a resolver, and it has to
 * reach the node unchanged.
 *
 * Two things can go wrong quietly here and both are pinned below. The setting
 * can be dropped on the way (Zod strips what the schema does not declare, which
 * is exactly how realityMode was lost once already), and two profiles on one
 * node can end up asking for different resolvers, which the core refuses whole
 * rather than half-applies.
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

const YANDEX = {
  servers: [
    {
      address: '77.88.8.8',
      domains: ['geosite:category-ru'],
      expectIps: ['geoip:ru'],
      skipFallback: true,
    },
    { address: '8.8.8.8' },
  ],
  queryStrategy: 'UseIPv4',
};

const CLOUDFLARE = { servers: [{ address: '1.1.1.1' }] };

/** What the schema stores: it fills the optional halves of every server, so a
 *  literal written the short way is not what comes back. Comparing against the
 *  short form would pass today and break the moment a default is added. */
function stored(dns: { servers: Record<string, unknown>[]; queryStrategy?: string }) {
  return {
    ...dns,
    servers: dns.servers.map((s) => ({
      domains: [],
      expectIps: [],
      skipFallback: false,
      ...s,
    })),
  };
}

async function makeProfile(dns?: unknown, expected = 201) {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: {
      name: `dns-profile-${seq}`,
      protocol: 'xray',
      config: {
        security: 'reality',
        realityDest: 'www.microsoft.com:443',
        realityServerNames: ['www.microsoft.com'],
        realityPrivateKey: 'k'.repeat(43),
        realityPublicKey: 'p'.repeat(43),
        realityShortIds: ['0123abcd'],
        network: 'raw',
        ...(dns ? { dns } : {}),
      },
    },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return JSON.parse(res.body);
}

async function makeNode(): Promise<string> {
  seq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `dns-node-${seq}`, address: `dns-${seq}.test`, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function bind(profileId: string, nodeId: string, port: number, expected = 201) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId, nodeId, port },
  });
  expect(res.statusCode, res.body).toBe(expected);
  return res;
}

describe('a profile can name its resolver', () => {
  it('keeps the whole setting through the schema', async () => {
    // Zod strips undeclared keys, and that is how realityMode was silently lost
    // once: the wire, the node and the subscription all read it, and only the
    // schema did not know about it.
    const p = await makeProfile(YANDEX);
    expect(p.config.dns).toEqual(stored(YANDEX));
  });

  it('defaults to naming nobody, which is what every profile does today', async () => {
    const p = await makeProfile();
    expect(p.config.dns).toBeUndefined();
  });

  it('hands it to the node in the inbound the push carries', async () => {
    const p = await makeProfile(YANDEX);
    const nodeId = await makeNode();
    await bind(p.id, nodeId, 443);

    const inbounds = await fetchEnabledInbounds(nodeId);
    expect(inbounds).toHaveLength(1);
    expect((inbounds[0]!.config as { dns?: unknown }).dns).toEqual(stored(YANDEX));
  });

  it('refuses a resolver with no servers rather than sending an empty section', async () => {
    await makeProfile({ servers: [] }, 400);
  });
});

describe('one node, one resolver', () => {
  it('refuses to deploy a second profile that wants a different one', async () => {
    // The core has a single dns section per process. The node refuses such a
    // config too, but as a failed push minutes later; here it is the answer to
    // the click that caused it, and it names the profile already there.
    const nodeId = await makeNode();
    const first = await makeProfile(YANDEX);
    const second = await makeProfile(CLOUDFLARE);
    await bind(first.id, nodeId, 443);

    const res = await bind(second.id, nodeId, 8443, 409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('DNS_RESOLVER_CONFLICT');
    expect(body.message).toContain(first.name);
  });

  it('allows a second profile that wants the SAME one', async () => {
    const nodeId = await makeNode();
    const first = await makeProfile(YANDEX);
    const second = await makeProfile(YANDEX);
    await bind(first.id, nodeId, 443);
    await bind(second.id, nodeId, 8443);
  });

  it('allows a second profile with no opinion: that is not a disagreement', async () => {
    const nodeId = await makeNode();
    const first = await makeProfile(YANDEX);
    const second = await makeProfile();
    await bind(first.id, nodeId, 443);
    await bind(second.id, nodeId, 8443);
  });

  it('refuses an EDIT that would give a node two resolvers', async () => {
    const nodeId = await makeNode();
    const first = await makeProfile(YANDEX);
    const second = await makeProfile(YANDEX);
    await bind(first.id, nodeId, 443);
    await bind(second.id, nodeId, 8443);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${second.id}`,
      headers: auth(),
      payload: { config: { ...second.config, dns: CLOUDFLARE } },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).error).toBe('DNS_RESOLVER_CONFLICT');
  });

  it('lets a profile change its resolver when it is alone on its node', async () => {
    const nodeId = await makeNode();
    const p = await makeProfile(YANDEX);
    await bind(p.id, nodeId, 443);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${p.id}`,
      headers: auth(),
      payload: { config: { ...p.config, dns: CLOUDFLARE } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).config.dns).toEqual(stored(CLOUDFLARE));
  });

  it('does not compare a profile against itself when editing', async () => {
    // An edit that leaves the resolver alone must not read the profile's own
    // binding as a conflicting sibling.
    const nodeId = await makeNode();
    const p = await makeProfile(YANDEX);
    await bind(p.id, nodeId, 443);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${p.id}`,
      headers: auth(),
      payload: { description: 'renamed' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});
