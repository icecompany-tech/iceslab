import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateSrrCache } from '../srr/srr.service.js';

let app: FastifyInstance;
let token: string;

async function createUser(
  username: string,
  enabledProtocols?: string[],
): Promise<{
  id: string;
  subscriptionToken: string;
  hysteriaPassword: string;
  xrayUuid: string;
}> {
  const payload: Record<string, unknown> = { username };
  if (enabledProtocols) payload.enabledProtocols = enabledProtocols;
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  }
  const body = JSON.parse(res.body);
  // Subscription token is in the public DTO; hysteriaPassword/xrayUuid aren't,
  // so pull them directly from the DB for assertions.
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: body.id },
    select: { hysteriaPassword: true, xrayUuid: true },
  });
  return {
    id: body.id,
    subscriptionToken: body.subscriptionToken,
    hysteriaPassword: persisted.hysteriaPassword,
    xrayUuid: persisted.xrayUuid,
  };
}

/**
 * Test helper: creates a node + a Hysteria profile-binding on port 443.
 * Slice 27: inbounds split into Profile (template) + ProfileNodeBinding
 * (per-node deployment). Each call creates a fresh profile so subscription
 * sees the binding through the auto-attached "All" squad.
 */
async function createNode(name: string, address: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, address },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createNode failed: ${res.statusCode} ${res.body}`);
  }
  const nodeId = JSON.parse(res.body).id as string;
  await createHysteriaInbound(nodeId);
  return nodeId;
}

async function createProfile(
  protocol: string,
  config: Record<string, unknown>,
  nameSuffix: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: `${protocol}-${nameSuffix}`,
      protocol,
      config,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createProfile failed: ${res.statusCode} ${res.body}`);
  }
  return JSON.parse(res.body).id;
}

async function createBinding(profileId: string, nodeId: string, port: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bindings',
    headers: { authorization: `Bearer ${token}` },
    payload: { profileId, nodeId, port },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createBinding failed: ${res.statusCode} ${res.body}`);
  }
  return JSON.parse(res.body).id;
}

async function createHysteriaInbound(nodeId: string, port = 443): Promise<string> {
  // Each call creates a fresh per-node profile so port collisions don't
  // happen across nodes and we mimic the pre-slice-27 "one inbound per
  // (node, port)" shape the existing assertions expect.
  const profileId = await createProfile('hysteria', {}, `${nodeId.slice(0, 6)}-${port}`);
  return createBinding(profileId, nodeId, port);
}

async function createXrayInbound(nodeId: string, port = 8443): Promise<string> {
  const profileId = await createProfile(
    'xray',
    {
      realityDest: 'www.cloudflare.com:443',
      realityServerNames: ['www.cloudflare.com'],
      realityShortIds: ['abc123'],
      realityPrivateKey: 'test-pubkey-for-vitest',
      realityPublicKey: 'test-pubkey-for-vitest',
    },
    `${nodeId.slice(0, 6)}-${port}`,
  );
  return createBinding(profileId, nodeId, port);
}

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  invalidateSrrCache(); // the SRR service caches compiled rules; reset between tests
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('GET /sub/:token (default text/plain)', () => {
  it('returns base64-encoded URI list with one entry per active node', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');
    await createNode('us-1', '10.0.0.2:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const decoded = Buffer.from(res.body, 'base64').toString('utf8');
    const lines = decoded.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^hysteria2:\/\//);
      expect(line).toContain(encodeURIComponent(user.hysteriaPassword));
    }
    // Host extracted from node.address; port forced to HYSTERIA_PUBLIC_PORT (443),
    // independent of the control-plane port baked into nodes.address.
    expect(lines[0]).toContain('10.0.0.1:443');
    expect(lines[0]).toContain('eu-1');
  });

  it('returns an empty base64 body when no nodes exist', async () => {
    const user = await createUser('alice');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });

    expect(res.statusCode).toBe(200);
    const decoded = Buffer.from(res.body, 'base64').toString('utf8');
    expect(decoded).toBe('');
  });
});

describe('GET /sub/:token (JSON format)', () => {
  it('returns structured JSON when ?format=json', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = JSON.parse(res.body);
    expect(body.user.id).toBe(user.id);
    expect(body.user.username).toBe('alice');
    expect(body.user.status).toBe('active');
    expect(body.user.trafficUsedBytes).toBe(0);
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].protocol).toBe('hysteria');
    expect(body.endpoints[0].nodeName).toBe('eu-1');
    expect(body.endpoints[0].uri).toMatch(/^hysteria2:\/\//);
  });

  it('refuses a format it does not serve, by name', async () => {
    // A client asking for something this build has no builder for used to get
    // a bare 400 from the schema: no way to tell a typo from a panel older
    // than the client. The reader is usually a config file, but the person
    // debugging it needs the sentence.
    const user = await createUser('alice');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=mieru-json`,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('UNKNOWN_FORMAT');
    expect(body.message).toContain('mieru-json');
    // And it lists what IS served, so the answer is actionable on its own.
    expect(body.message).toContain('clash');
    expect(body.message).toContain('xrayjson-array');
  });

  it('returns JSON when Accept: application/json', async () => {
    const user = await createUser('alice');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: { accept: 'application/json' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.body);
    expect(body.user.username).toBe('alice');
  });
});

describe('GET /sub/:token - SRR auto-format (slice 22)', () => {
  it('selects format from a UA rule when no ?format= is given', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    await prisma.subscriptionResponseRule.create({
      data: {
        name: 'Hiddify',
        uaPattern: 'Hiddify',
        format: 'singbox',
        priority: 10,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: { 'user-agent': 'Hiddify/2.5.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const cfg = JSON.parse(res.body);
    // singbox shape, not the simpler /sub JSON shape
    expect(cfg.outbounds).toBeDefined();
    expect(cfg.route).toBeDefined();
  });

  it('explicit ?format= still wins over a matching SRR rule', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');
    await prisma.subscriptionResponseRule.create({
      data: { name: 'Hiddify', uaPattern: 'Hiddify', format: 'singbox', priority: 10 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=clash`,
      headers: { 'user-agent': 'Hiddify/2.5.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/yaml');
  });

  it('falls back to plain when UA does not match any rule', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');
    await prisma.subscriptionResponseRule.create({
      data: { name: 'Hiddify', uaPattern: 'Hiddify', format: 'singbox', priority: 10 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: { 'user-agent': 'curl/8.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });
});

describe('GET /sub/:token - multi-format (slice 21)', () => {
  it('returns Clash YAML when ?format=clash', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=clash`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/yaml');
    expect(res.body).toContain('proxies:');
    expect(res.body).toContain('type: hysteria2');
    expect(res.body).toContain('eu-1-hysteria');
    expect(res.body).toContain('- MATCH,Auto');
  });

  it('returns Sing-box JSON when ?format=singbox', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=singbox`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const cfg = JSON.parse(res.body);
    expect(cfg.outbounds.find((o: { type: string }) => o.type === 'hysteria2')).toBeDefined();
    expect(cfg.outbounds.find((o: { tag: string }) => o.tag === 'Auto')).toBeDefined();
    expect(cfg.route.final).toBe('Auto');
  });

  it('returns Xray JSON when ?format=xrayjson', async () => {
    const user = await createUser('alice', ['hysteria', 'xray']);
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');
    await createXrayInbound(nodeId);

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=xrayjson`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const cfg = JSON.parse(res.body);
    expect(cfg.inbounds[0].protocol).toBe('socks');
    const v = cfg.outbounds.find((o: { protocol: string }) => o.protocol === 'vless');
    // The tag is the endpoint's identity, not its display name: it survives
    // renaming the node, and it is what the catch-all rule points at.
    expect(v.tag).toMatch(/^proxy-[0-9a-f]{8}$/);
    const catchAll = cfg.routing.rules[cfg.routing.rules.length - 1];
    expect(catchAll.outboundTag).toBe(v.tag);
    expect(v.streamSettings.network).toBe('raw');
  });

  it('returns empty wgconf body when user has no AmneziaWG endpoint', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=wgconf`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe('');
  });

  it('rejects unknown ?format value with 400', async () => {
    const user = await createUser('alice');
    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=bogus`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('explicit ?format=plain wins over Accept: application/json', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=plain`,
      headers: { accept: 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // body is base64, not JSON
    expect(() => JSON.parse(res.body)).toThrow();
  });
});

describe('GET /sub/:token - error cases', () => {
  it('returns 404 for unknown token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sub/this-token-does-not-exist-anywhere',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for soft-deleted user', async () => {
    const user = await createUser('gone');
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    // soft-deleted user is invisible, looks like an unknown token (404)
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 REVOKED when subRevokedAt is set', async () => {
    const user = await createUser('rev');
    await prisma.user.update({
      where: { id: user.id },
      data: { subRevokedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('REVOKED');
  });

  it('returns 403 DISABLED when status=disabled', async () => {
    const user = await createUser('dis');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'disabled' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('DISABLED');
  });

  it('returns 403 EXPIRED when status=expired', async () => {
    const user = await createUser('exp');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'expired' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('EXPIRED');
  });

  it('returns 403 LIMITED when status=limited', async () => {
    const user = await createUser('lim');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'limited' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('LIMITED');
  });
});

describe('GET /sub/:token - multi-protocol (slice 18)', () => {
  it('user with enabledProtocols=["hysteria","xray"] gets both endpoints per node', async () => {
    const user = await createUser('alice', ['hysteria', 'xray']);
    const nodeId = await createNode('eu-1', '10.0.0.1:8443');
    await createXrayInbound(nodeId);

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.endpoints).toHaveLength(2);
    const protocols = body.endpoints.map((e: { protocol: string }) => e.protocol).sort();
    expect(protocols).toEqual(['hysteria', 'xray']);

    const xray = body.endpoints.find((e: { protocol: string }) => e.protocol === 'xray');
    expect(xray.uri).toMatch(/^vless:\/\//);
    expect(xray.uri).toContain(user.xrayUuid);
    expect(xray.uri).toContain('security=reality');
    expect(xray.uri).toContain('sid=abc123');
  });

  it('user with enabledProtocols=["hysteria"] only gets hysteria endpoints', async () => {
    const user = await createUser('bob', ['hysteria']);
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
    });

    const body = JSON.parse(res.body);
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].protocol).toBe('hysteria');
  });

  it('default user (no enabledProtocols passed) gets hysteria-only', async () => {
    const user = await createUser('carol');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
    });

    const body = JSON.parse(res.body);
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].protocol).toBe('hysteria');
    expect(body.user.id).toBe(user.id);
  });
});

describe('GET /sub/:token - audit', () => {
  it('writes a row to subscription_request_history', async () => {
    const user = await createUser('alice');

    const before = await prisma.subscriptionRequestHistory.count({
      where: { userId: user.id },
    });

    await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: {
        'user-agent': 'test-client/1.0',
        'x-forwarded-for': '203.0.113.1',
      },
    });

    const after = await prisma.subscriptionRequestHistory.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
    });
    expect(after.length).toBe(before + 1);
    expect(after[0]!.userAgent).toBe('test-client/1.0');
  });
});

describe('a subscription that is not in force', () => {
  /**
   * The worst page of the product used to be the one a lapsed subscriber saw:
   * a raw JSON error object, shown to exactly the person worth getting back.
   *
   * The rule is narrow. Only a request already recognised as a browser asking
   * for a page gets HTML; the status stays 403; everyone else gets the same
   * JSON, byte for byte, so anything reading that 403 sees no change at all.
   */
  const browser = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  };

  it('shows the page, and still answers 403', async () => {
    const user = await createUser('lapsed');
    await createNode('lapsed-n', '10.0.0.31:8443');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'expired' } });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: browser,
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('lapsed');
    // It says what happened and what to do, not "FORBIDDEN".
    expect(res.body).toContain('Renew it');
    expect(res.body).not.toContain('"error":"FORBIDDEN"');
  });

  it('leaves the JSON refusal exactly as it was for everyone else', async () => {
    const user = await createUser('lapsed-2');
    await createNode('lapsed-n2', '10.0.0.32:8443');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'expired' } });

    const cases: Array<[Record<string, string>, string]> = [
      [{}, ''],
      [{ 'user-agent': 'Happ/1.0' }, ''],
      [{ accept: 'application/json' }, ''],
      // A browser that asked for a FORMAT is a client, not a reader: the
      // page is only for the request that wanted a page.
      [browser, '?format=clash'],
    ];
    for (const [headers, qs] of cases) {
      const res = await app.inject({
        method: 'GET',
        url: `/sub/${user.subscriptionToken}${qs}`,
        headers,
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        error: 'FORBIDDEN',
        message: 'Subscription is expired',
        reason: 'EXPIRED',
      });
    }
  });

  it('never calls a withdrawn subscription active', async () => {
    // A revoked link belongs to a user whose row still says `active`, and
    // that is the one word this page must not print to somebody it has just
    // turned away. The refusal decides the wording, not the stored status.
    const user = await createUser('revoked-1');
    await createNode('revoked-n', '10.0.0.33:8443');
    await prisma.user.update({ where: { id: user.id }, data: { subRevokedAt: new Date() } });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: browser,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('withdrawn');
    expect(res.body).not.toContain('>active<');
  });

  it('offers nothing it cannot deliver', async () => {
    /**
     * The live question the previous version of this test recorded is now
     * settled, and the other way round: the refusal page carries the state
     * card, the link with its copy button, and support. Nothing else.
     *
     * The downloads block used to stay with an amber plate, and the install
     * block appeared through the branch built for a WORKING subscription whose
     * fleet is unreachable. On a refused one that branch offered apps whose
     * one-tap import leads straight back to the 403 that produced the page.
     */
    const user = await createUser('lapsed-3');
    await createNode('lapsed-n3', '10.0.0.34:8443');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'limited' } });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: browser,
    });
    expect(res.statusCode).toBe(403);
    // Nothing that would lead the reader into the same refusal.
    expect(res.body).not.toContain('id="downloads"');
    expect(res.body).not.toContain('data-platform=');
    expect(res.body).not.toContain('format=plain');
    expect(res.body).not.toContain('data-copy-config="');
    // The three that remain, end to end through the real route.
    expect(res.body).toContain('sub-card');
    expect(res.body).toContain(user.subscriptionToken);
    expect(res.body).toContain('id="copy-inline"');
    expect(res.body).toContain('The link does not change');
  });
});

describe('a stored config that is missing fields', () => {
  /**
   * `config` is jsonb. The zod schema defaults the REALITY arrays and the
   * AmneziaWG obfuscation block, but only on the way in through the API: a row
   * written by a seed script, by the migrate tool importing a foreign panel,
   * or by hand has whatever it has.
   *
   * Found on the local stand 2026-09-21. One seeded profile with no
   * `realityServerNames` answered 500 for EVERY user and EVERY format,
   * including users whose other endpoints were fine, because this loop builds
   * the whole subscription in one pass. The blast radius is what makes it
   * worth a test: one bad row took out the product.
   */
  it('still serves the subscription when a REALITY profile has no serverNames', async () => {
    const user = await createUser('jsonb-1');
    const nodeId = await createNode('jsonb-n1', '10.0.0.41:8443');
    const profileId = await createProfile(
      'xray',
      {
        realityDest: 'www.cloudflare.com:443',
        realityServerNames: ['www.cloudflare.com'],
        realityShortIds: ['abc123'],
        realityPrivateKey: 'test-pubkey-for-vitest',
        realityPublicKey: 'test-pubkey-for-vitest',
      },
      'jsonb-x',
    );
    await createBinding(profileId, nodeId, 9443);
    // The shape a seed leaves behind: the security mode says REALITY and the
    // fields it needs are simply absent.
    await prisma.profile.update({
      where: { id: profileId },
      data: { config: { security: 'reality', realityDest: 'www.cloudflare.com:443' } },
    });

    const res = await app.inject({ method: 'GET', url: `/sub/${user.subscriptionToken}` });
    expect(res.statusCode).toBe(200);
    // The hysteria endpoint from createNode is still there: one broken profile
    // must not take the working ones with it.
    const decoded = Buffer.from(res.body, 'base64').toString('utf8');
    expect(decoded).toContain('hysteria2://');
  });

  it('skips an AmneziaWG profile with no obfuscation instead of failing, or guessing', async () => {
    // Eleven numbers with no safe default: Jc/S/H decide what the traffic
    // looks like on the wire. Zeros would hand out a .conf that connects to
    // nothing, or connects and is conspicuous. So the endpoint is dropped and
    // the log says which profile to re-save.
    const user = await createUser('jsonb-2');
    const nodeId = await createNode('jsonb-n2', '10.0.0.42:8443');
    const profileId = await createProfile(
      'amneziawg',
      {
        subnet: '10.66.66.0/24',
        serverPrivateKey: 'a'.repeat(44),
        serverPublicKey: 'b'.repeat(44),
        obfuscation: {},
      },
      'jsonb-awg',
    );
    await createBinding(profileId, nodeId, 51820);
    await prisma.profile.update({
      where: { id: profileId },
      data: { config: { subnet: '10.66.66.0/24', serverPublicKey: 'b'.repeat(44) } },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
      headers: { accept: 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.endpoints.some((e: { protocol: string }) => e.protocol === 'amneziawg')).toBe(false);
    expect(body.endpoints.some((e: { protocol: string }) => e.protocol === 'hysteria')).toBe(true);
  });
});

describe('the download flag', () => {
  /**
   * `&dl=1` says "save this", and it is a flag of its own rather than a
   * property of the format.
   *
   * The format addresses are a contract: `?format=clash` and
   * `?format=singbox` get pasted into apps and polled for months. Attaching a
   * Content-Disposition to them would probably change nothing, because a
   * programmatic fetch ignores the header, and "probably" is not a reason to
   * alter an address somebody else depends on.
   */
  it('leaves the plain addresses exactly as they were', async () => {
    const user = await createUser('dl-1');
    await createNode('dl-n1', '10.0.0.21:8443');
    for (const url of [
      `/sub/${user.subscriptionToken}?format=clash`,
      `/sub/${user.subscriptionToken}?format=singbox`,
      `/sub/${user.subscriptionToken}`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-disposition'], url).toBeUndefined();
    }
  });

  it('turns a response into a file when asked, with a name that tells them apart', async () => {
    const user = await createUser('dl-2');
    await createNode('dl-n2', '10.0.0.22:8443');
    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=clash&dl=1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="dl-2-clash.yaml"');
    // The body is untouched: this is the same response, delivered differently.
    expect(res.headers['content-type']).toContain('text/yaml');
  });

  it('never attaches the flag to the raw subscription', async () => {
    // `plain` is what a client pulls from the bare link. It is the one address
    // that must behave identically with the flag and without it.
    const user = await createUser('dl-3');
    await createNode('dl-n3', '10.0.0.23:8443');
    const withFlag = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=plain&dl=1`,
    });
    const without = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=plain`,
    });
    expect(withFlag.headers['content-disposition']).toBeUndefined();
    expect(withFlag.body).toBe(without.body);
  });

  it('does not disturb the formats that already sent a filename', async () => {
    // wgconf and xkeen attached one unconditionally long before this flag
    // existed, and theirs is the better name (it carries the node).
    const user = await createUser('dl-4');
    await createNode('dl-n4', '10.0.0.24:8443');
    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=xkeen`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="dl-4-xkeen.json"');
  });
});
