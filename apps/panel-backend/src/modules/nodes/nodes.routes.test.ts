import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { decodeNodePayload } from '../keygen/keygen.service.js';

let app: FastifyInstance;
let token: string;

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

describe('POST /api/nodes', () => {
  it('creates a node and returns a one-time mTLS payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: 'eu-1',
        address: '10.0.0.1:8443',
        countryCode: 'DE',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('eu-1');
    expect(body.address).toBe('10.0.0.1:8443');
    expect(body.countryCode).toBe('DE');
    expect(body.status).toBe('unknown');
    expect(body.consumptionMultiplier).toBe('1');
    expect(typeof body.payload).toBe('string');

    const decoded = decodeNodePayload(body.payload);
    expect(decoded.nodeCertPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(decoded.nodeKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(decoded.caCertPem).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { name: 'eu-1', address: '10.0.0.1:8443' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 409 on duplicate name', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: '10.0.0.1:8443' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: '10.0.0.2:8443' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 409 on duplicate address', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: '10.0.0.1:8443' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-2', address: '10.0.0.1:8443' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 400 for invalid address (with scheme)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: 'https://10.0.0.1:8443' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/nodes', () => {
  it('returns a paginated list', async () => {
    for (const [name, addr] of [
      ['eu-1', '10.0.0.1:8443'],
      ['eu-2', '10.0.0.2:8443'],
      ['eu-3', '10.0.0.3:8443'],
    ]) {
      await app.inject({
        method: 'POST',
        url: '/api/nodes',
        headers: auth(),
        payload: { name, address: addr },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes?page=1&limit=10',
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(3);
    expect(body.nodes).toHaveLength(3);
    // Public DTOs must not include the secret payload
    for (const n of body.nodes) {
      expect(n).not.toHaveProperty('payload');
    }
  });
});

describe('GET /api/nodes/:id', () => {
  it('returns the node by id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: '10.0.0.1:8443' },
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'GET',
      url: `/api/nodes/${id}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('eu-1');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/nodes/:id', () => {
  it('updates address and country', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'eu-1', address: '10.0.0.1:8443' },
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${id}`,
      headers: auth(),
      payload: { address: '10.0.0.99:8443', countryCode: 'NL' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.address).toBe('10.0.0.99:8443');
    expect(body.countryCode).toBe('NL');
  });
});

describe('node hardening (Zashchita) → install command', () => {
  it('persists hardening and appends matching flags to the bootstrap command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: 'hard-1',
        address: '10.0.0.5:1337',
        protocol: 'xray',
        hardening: {
          ufwLockdown: true,
          fail2ban: true,
          realisticFallback: true,
          sshAllowlist: ['203.0.113.4', '10.0.0.0/8'],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    // Public DTO echoes the stored blob.
    expect(body.hardening).toMatchObject({
      ufwLockdown: true,
      fail2ban: true,
      realisticFallback: true,
      sshAllowlist: ['203.0.113.4', '10.0.0.0/8'],
    });
    // Generated install command carries each flag.
    const cmd: string = body.bootstrap.command;
    expect(cmd).toContain('--harden-ufw');
    expect(cmd).toContain('--fail2ban');
    expect(cmd).toContain('--realistic-fallback');
    expect(cmd).toContain('--ssh-allowlist 203.0.113.4,10.0.0.0/8');
  });

  it('omits all hardening flags when hardening is absent (byte-identical to today)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'plain-1', address: '10.0.0.6:1337', protocol: 'xray' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.hardening).toBeNull();
    const cmd: string = body.bootstrap.command;
    expect(cmd).not.toContain('--harden-ufw');
    expect(cmd).not.toContain('--fail2ban');
    expect(cmd).not.toContain('--realistic-fallback');
    expect(cmd).not.toContain('--ssh-allowlist');
  });

  it('installs every intended core: --engines in the create and the refresh command alike', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: 'engines-1',
        address: '10.0.0.8:1337',
        intendedEngines: ['xray', 'hysteria', 'singbox'],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = JSON.parse(created.body);
    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/nodes/${body.id}/bootstrap`,
      headers: auth(),
    });
    const enginesLine = (s: string) => s.split('\n').filter((l) => l.includes('--engines'));
    expect(enginesLine(body.bootstrap.command)).toEqual(['  --engines xray,hysteria,singbox \\']);
    expect(enginesLine(JSON.parse(refreshed.body).command)).toEqual(enginesLine(body.bootstrap.command));
    // Right after the token, carrying its own continuation, and no --protocol:
    // the cores are a set, none of them the main one (25.09).
    expect(body.bootstrap.command).toContain('--bootstrap ');
    expect(body.bootstrap.command).toMatch(/--bootstrap \S+ \\\n {2}--engines xray,hysteria,singbox \\\n/);
    for (const cmd of [body.bootstrap.command, JSON.parse(refreshed.body).command]) {
      expect(cmd).not.toContain('--protocol');
    }
  });

  it('E30: a node on an IP gets no hysteria domain, and its REALITY domain is not taken for one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'ru-ip', address: '46.149.66.235:1337', domain: 'cam.example.com', intendedEngines: ['hysteria'] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = JSON.parse(created.body);
    const refreshed = JSON.parse(
      (await app.inject({ method: 'POST', url: `/api/nodes/${body.id}/bootstrap`, headers: auth() })).body,
    );
    for (const cmd of [body.bootstrap.command as string, refreshed.command as string]) {
      expect(cmd).toContain('--engines hysteria');
      expect(cmd).not.toContain('--hysteria-domain');
      expect(cmd).not.toContain('--hysteria-email');
      expect(cmd).not.toContain('cam.example.com');
    }
  });

  it('an old create body (protocol alone) installs its core by --engines', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'old-form-1', address: 'hy.example.com:1337', protocol: 'hysteria' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const cmd: string = JSON.parse(created.body).bootstrap.command;
    expect(cmd).toContain('  --engines hysteria \\');
    expect(cmd).toContain('--hysteria-domain hy.example.com');
    expect(cmd).not.toContain('--protocol');
  });

  it('create and refresh commands carry the same hardening flags (mirror contract)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: 'mirror-1',
        address: '10.0.0.7:1337',
        protocol: 'xray',
        hardening: { ufwLockdown: true, sshAllowlist: ['198.51.100.1'] },
      },
    });
    const createdBody = JSON.parse(created.body);
    const createCmd: string = createdBody.bootstrap.command;

    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/nodes/${createdBody.id}/bootstrap`,
      headers: auth(),
    });
    expect(refreshed.statusCode).toBe(201);
    const refreshCmd: string = JSON.parse(refreshed.body).command;

    // The bootstrap token differs between the two, but the hardening tail must
    // be byte-identical (both renderers share appendHardeningFlags). Compare
    // just the hardening flag lines. Helper emits a fixed order: ufwLockdown,
    // fail2ban, realisticFallback, sshAllowlist.
    const hardeningLines = (s: string) =>
      s
        .split('\n')
        .filter((l) => /--harden-ufw|--fail2ban|--realistic-fallback|--ssh-allowlist/.test(l))
        .map((l) => l.trim());
    expect(hardeningLines(createCmd)).toEqual([
      '--harden-ufw \\',
      '--ssh-allowlist 198.51.100.1',
    ]);
    expect(hardeningLines(refreshCmd)).toEqual(hardeningLines(createCmd));
  });

  it('rejects an unknown hardening key with 400 (strict schema)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: {
        name: 'bad-1',
        address: '10.0.0.8:1337',
        hardening: { ufwLockown: true },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/nodes/:id', () => {
  it('soft-deletes the node', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'gone', address: '10.0.0.1:8443' },
    });
    const { id } = JSON.parse(created.body);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: `/api/nodes/${id}`,
      headers: auth(),
    });
    expect(get.statusCode).toBe(404);
  });
});
