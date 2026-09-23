import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { SINGBOX_XRAY_FAMILY_MESSAGE, singboxRefusesXrayField } from './profiles.schemas.js';

/**
 * sing-box serves the xray family (vless, vmess, trojan) only as REALITY
 * steal-others over raw. The agent refuses the rest at push
 * (apps/node/internal/core/singbox/adapter.go, toInboundConfig); the save now
 * says it while the operator is on the form, with the field in `path`.
 */
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

const reality = {
  subprotocol: 'vless',
  security: 'reality',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: ['www.microsoft.com'],
  realityPrivateKey: 'k'.repeat(43),
  realityPublicKey: 'p'.repeat(43),
  realityShortIds: ['0123abcd'],
  network: 'raw',
};
const tls = {
  subprotocol: 'trojan',
  security: 'tls',
  tlsServerName: 'n.example.com',
  network: 'raw',
};

async function create(name: string, config: Record<string, unknown>, engine?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: auth(),
    payload: { name, protocol: 'xray', engine, config },
  });
}

/** The path of the one issue a refused create carries. */
function issuePath(body: string): unknown {
  const b = JSON.parse(body) as { issues?: Array<{ path: unknown; message: string }> };
  const issue = b.issues?.find((i) => i.message === SINGBOX_XRAY_FAMILY_MESSAGE);
  return issue?.path;
}

describe('an xray-family profile on the sing-box engine', () => {
  it('saves as REALITY steal-others over raw', async () => {
    const res = await create('sb-reality', reality, 'singbox');
    expect(res.statusCode, res.body).toBe(201);
  });

  it('is refused with TLS or none, the path on security', async () => {
    for (const [name, cfg] of [['sb-tls', tls], ['sb-none', { ...reality, security: 'none' }]] as const) {
      const res = await create(name, cfg, 'singbox');
      expect(res.statusCode, res.body).toBe(400);
      expect(issuePath(res.body)).toEqual(['config', 'security']);
    }
  });

  it('is refused as REALITY self-steal, the path on realityMode', async () => {
    const res = await create('sb-self', { ...reality, realityMode: 'self-steal' }, 'singbox');
    expect(res.statusCode, res.body).toBe(400);
    expect(issuePath(res.body)).toEqual(['config', 'realityMode']);
  });

  it('is refused on another transport, the path on network', async () => {
    const res = await create('sb-ws', { ...reality, network: 'ws' }, 'singbox');
    expect(res.statusCode, res.body).toBe(400);
    expect(issuePath(res.body)).toEqual(['config', 'network']);
  });

  it('refuses moving an existing TLS profile onto sing-box, and keeps it on xray', async () => {
    const created = await create('xr-tls', tls);
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${id}`,
      headers: auth(),
      payload: { engine: 'singbox' },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'INVALID',
      message: SINGBOX_XRAY_FAMILY_MESSAGE,
      path: ['config', 'security'],
    });
    expect((await prisma.profile.findUniqueOrThrow({ where: { id } })).engine).toBeNull();
  });

  it('refuses editing a sing-box profile onto another transport', async () => {
    const created = await create('sb-edit', reality, 'singbox');
    const id = JSON.parse(created.body).id as string;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${id}`,
      headers: auth(),
      payload: { config: { ...reality, network: 'grpc' } },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).path).toEqual(['config', 'network']);
  });

  it('refuses a binding whose overrides pin another transport, the path on the override', async () => {
    // The node is pushed the profile merged with the binding's overrides.
    const created = await create('sb-bind', reality, 'singbox');
    const profileId = JSON.parse(created.body).id as string;
    const node = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: 'sb-node', address: '10.0.0.9:8443' },
    });
    const nodeId = JSON.parse(node.body).id as string;
    const bad = await app.inject({
      method: 'POST',
      url: '/api/bindings',
      headers: auth(),
      payload: { profileId, nodeId, port: 8443, overrides: { network: 'xhttp' } },
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(JSON.parse(bad.body).path).toEqual(['overrides', 'network']);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/bindings',
      headers: auth(),
      payload: { profileId, nodeId, port: 8443 },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/bindings/${JSON.parse(ok.body).id as string}`,
      headers: auth(),
      payload: { overrides: { security: 'none' } },
    });
    expect(edit.statusCode, edit.body).toBe(400);
    expect(JSON.parse(edit.body).path).toEqual(['overrides', 'security']);
  });

  it('leaves the same configs alone on the xray engine', async () => {
    for (const [name, cfg] of [
      ['xr-tls-ok', tls],
      ['xr-self-ok', { ...reality, realityMode: 'self-steal' }],
      ['xr-ws-ok', { ...reality, network: 'ws' }],
    ] as const) {
      const res = await create(name, cfg, 'xray');
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
  });
});

describe('singboxRefusesXrayField', () => {
  it('mirrors the agent: absent values pass, socks and http are not its question', () => {
    expect(singboxRefusesXrayField('xray', 'singbox', {})).toBeNull();
    expect(singboxRefusesXrayField('xray', 'singbox', { security: '', network: '' })).toBeNull();
    expect(singboxRefusesXrayField('xray', 'singbox', { subprotocol: 'socks', security: 'none' })).toBeNull();
    expect(singboxRefusesXrayField('xray', 'xray', { security: 'tls' })).toBeNull();
    expect(singboxRefusesXrayField('shadowsocks', 'singbox', { network: 'ws' })).toBeNull();
    // The legacy alias the agent does not map either.
    expect(singboxRefusesXrayField('xray', 'singbox', { network: 'tcp' })).toBe('network');
  });
});
