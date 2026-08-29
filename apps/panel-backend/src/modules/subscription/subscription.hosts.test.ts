import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { registerBindingsCacheBust } from './subscription.bindings-cache.js';

/**
 * What a subscription contains is decided by hosts, and until 2026-07-30 a
 * binding with none still emitted one nameless endpoint labelled with the NODE
 * name. Seen in the field: a host was deleted in the panel and came back in the
 * client as "nl2".
 *
 * The rows below pin the two ways an operator reaches zero hosts, delete and
 * disable, because the panel promises both remove the line ("Off hides it from
 * every subscription") and nothing tested that promise.
 */
let app: FastifyInstance;
let token: string;

// Cache-busting is wired in index.ts, not buildApp, so a test that edits config
// mid-run and re-reads the subscription would otherwise be served the cached
// answer. Subscribed once: the bus has no unsubscribe.
beforeAll(() => registerBindingsCacheBust());

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function seed() {
  const profile = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: auth(),
        payload: {
          name: 'sub-profile',
          protocol: 'xray',
          config: {
            security: 'reality',
            realityDest: 'www.microsoft.com:443',
            realityServerNames: ['www.microsoft.com'],
            realityPrivateKey: 'k'.repeat(43),
            realityPublicKey: 'p'.repeat(43),
            realityShortIds: ['0123abcd'],
            network: 'raw',
          },
        },
      })
    ).body,
  );
  const node = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/nodes',
        headers: auth(),
        payload: { name: 'sub-node', address: 'sub.example.com', protocol: 'xray' },
      })
    ).body,
  );
  const host = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/hosts',
        headers: auth(),
        payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'Direct' },
      })
    ).body,
  );
  const squad = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/squads',
        headers: auth(),
        payload: { name: 'sub-squad', profileIds: [profile.id] },
      })
    ).body,
  );
  const user = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: auth(),
        payload: { username: 'sub_user', groupIds: [squad.id] },
      })
    ).body,
  );
  return { profile, node, host, squad, user };
}

/** Server names the client would show, one per line of the plain format. */
async function serverNames(subToken: string): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/sub/${subToken}?format=plain` });
  expect(res.statusCode).toBe(200);
  const body = Buffer.from(res.body, 'base64').toString('utf8');
  return body
    .split('\n')
    .filter(Boolean)
    .map((uri) => decodeURIComponent(uri.split('#')[1] ?? ''));
}

/** A second way into the SAME node: another transport, its own auto-created
 *  "Default" host, which is the state an operator reaches by clicking Add. */
async function addTransport(nodeId: string, name: string, network: string, port: number) {
  const profile = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: auth(),
        payload: {
          name,
          protocol: 'xray',
          config: {
            security: 'reality',
            realityDest: 'www.microsoft.com:443',
            realityServerNames: ['www.microsoft.com'],
            realityPrivateKey: 'k'.repeat(43),
            realityPublicKey: 'p'.repeat(43),
            realityShortIds: ['0123abcd'],
            network,
          },
        },
      })
    ).body,
  );
  await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: auth(),
    payload: { profileId: profile.id, nodeId, port },
  });
  return profile;
}

describe('two unnamed ways into one node', () => {
  /**
   * The label is the host's remark or, for a host nobody named, the node's own
   * name - so a second transport on one machine reads exactly like the first.
   * The operator reported that on 2026-08-29, and the same string is what
   * sing-box tags and Clash proxy names are built from, so the duplicate was
   * also a duplicate identifier (audit A-020).
   */
  it('reads as two lines naming what differs, in the client and in the link', async () => {
    const { profile, node, user, squad } = await seed();
    const xhttp = await addTransport(node.id, 'sub-xhttp', 'xhttp', 8443);
    const grpc = await addTransport(node.id, 'sub-grpc', 'grpc', 9443);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/squads/${squad.id}`,
      headers: auth(),
      payload: { profileIds: [profile.id, xhttp.id, grpc.id] },
    });
    expect(res.statusCode, res.body).toBe(200);

    const names = await serverNames(user.subscriptionToken);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.some((n) => n.includes('XHTTP'))).toBe(true);
    expect(names.some((n) => n.includes('gRPC'))).toBe(true);
  });
});

describe('subscription contents follow hosts', () => {
  it('serves the host, named after it rather than the node', async () => {
    const { user } = await seed();
    const names = await serverNames(user.subscriptionToken);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Direct');
    expect(names[0]).not.toContain('sub-node');
  });

  it('drops the line when the last host is deleted', async () => {
    const { host, user } = await seed();
    await app.inject({ method: 'DELETE', url: `/api/hosts/${host.id}`, headers: auth() });
    // The regression: this used to return one endpoint named "sub-node",
    // because a binding with no hosts fell back to a single nameless row.
    expect(await serverNames(user.subscriptionToken)).toEqual([]);
  });

  it('drops the line when the last host is merely switched off', async () => {
    const { host, user } = await seed();
    await app.inject({
      method: 'PUT',
      url: `/api/hosts/${host.id}`,
      headers: auth(),
      payload: { enabled: false },
    });
    // The panel says "Off hides it from every subscription" under that toggle.
    expect(await serverNames(user.subscriptionToken)).toEqual([]);
  });

  it('a squad that names hosts hands out only those', async () => {
    const { profile, node, host, user } = await seed();
    const second = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/hosts',
          headers: auth(),
          payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'CDN' },
        })
      ).body,
    );
    expect(await serverNames(user.subscriptionToken)).toHaveLength(2);

    // Narrow the ONLY squad this user is in to the second host.
    const squad = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/squads', headers: auth() })).body,
    ).squads.find((s: { name: string }) => s.name === 'sub-squad');
    await app.inject({
      method: 'PUT',
      url: `/api/squads/${squad.id}`,
      headers: auth(),
      payload: { hostIds: [second.id] },
    });

    const names = await serverNames(user.subscriptionToken);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('CDN');
    // The point of the whole feature: one profile, one inbound on the node,
    // different squads reaching different hosts of it.
    expect(host.id).toBeTruthy();
  });

  it('an empty list is not an empty squad: it restores every host', async () => {
    const { profile, node, user } = await seed();
    await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'CDN' },
    });
    const squad = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/squads', headers: auth() })).body,
    ).squads.find((s: { name: string }) => s.name === 'sub-squad');

    await app.inject({
      method: 'PUT',
      url: `/api/squads/${squad.id}`,
      headers: auth(),
      payload: { hostIds: [] },
    });
    // Clearing the list is how an operator removes the restriction, so it must
    // not read as "this squad reaches nothing".
    expect(await serverNames(user.subscriptionToken)).toHaveLength(2);
  });

  it('takes the binding with the last host, freeing the port', async () => {
    const { profile, node, host } = await seed();
    await app.inject({ method: 'DELETE', url: `/api/hosts/${host.id}`, headers: auth() });

    // No invisible leftover: the operator sees a node with nothing on it, and
    // the panel agrees.
    const bindings = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/bindings', headers: auth() })).body,
    ).bindings;
    expect(bindings.filter((b: { nodeId: string }) => b.nodeId === node.id)).toHaveLength(0);

    // And the port is genuinely free again: the same port on the same node is
    // accepted, which it was not while the empty binding still held it.
    const again = await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'Second life' },
    });
    expect(again.statusCode).toBe(201);
  });

  it('keeps the binding while any host remains', async () => {
    const { profile, node, host } = await seed();
    await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'CDN' },
    });
    await app.inject({ method: 'DELETE', url: `/api/hosts/${host.id}`, headers: auth() });
    const bindings = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/bindings', headers: auth() })).body,
    ).bindings;
    // Only the LAST host takes the binding down; removing one of two must not
    // disturb the node at all.
    expect(bindings.filter((b: { nodeId: string }) => b.nodeId === node.id)).toHaveLength(1);
  });

  it('keeps the surviving host when one of two is removed', async () => {
    const { profile, node, host, user } = await seed();
    await app.inject({
      method: 'POST',
      url: '/api/hosts',
      headers: auth(),
      payload: { profileId: profile.id, nodeId: node.id, port: 443, remark: 'CDN' },
    });
    await app.inject({ method: 'DELETE', url: `/api/hosts/${host.id}`, headers: auth() });
    const names = await serverNames(user.subscriptionToken);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('CDN');
  });
});
