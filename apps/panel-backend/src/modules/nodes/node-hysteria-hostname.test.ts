import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

/**
 * E30b, 25.09: native hysteria gets its certificate only through ACME, and no
 * public CA issues one for an IP. A native-hysteria host is not saved onto a
 * node addressed by IP: 409 HYSTERIA_NEEDS_HOSTNAME { nodeName, address }.
 * Hysteria on sing-box brings its own certificate and is let through. A
 * temporary gate, off when the agent issues a pinned certificate (E30a).
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
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: auth(), payload });

async function node(address: string): Promise<string> {
  seq += 1;
  const res = await post('/api/nodes', { name: `hy-${seq}`, address, intendedEngines: ['hysteria', 'singbox'] });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

async function profile(engine?: 'singbox'): Promise<string> {
  seq += 1;
  const res = await post('/api/profiles', { name: `hy-p-${seq}`, protocol: 'hysteria', config: {}, ...(engine ? { engine } : {}) });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id as string;
}

const refusal = (res: { statusCode: number; body: string }) => ({ status: res.statusCode, body: JSON.parse(res.body) });

describe('native hysteria goes only onto a node a CA issues for', () => {
  it('an IP address: the binding, the host and the host on an existing binding are refused', async () => {
    const nodeId = await node('46.149.66.235:1337');
    const profileId = await profile();
    const want = {
      status: 409,
      body: expect.objectContaining({ error: 'HYSTERIA_NEEDS_HOSTNAME', nodeName: 'hy-1', address: '46.149.66.235:1337' }),
    };
    const first = refusal(await post('/api/bindings', { profileId, nodeId, port: 443 }));
    expect(first).toEqual(want);
    expect(first.body.message).toMatch(/only through ACME/);
    expect(first.body.message).toMatch(/sing-box, which works on an IP/);
    expect(refusal(await post('/api/hosts', { profileId, nodeId, port: 443, remark: 'h' }))).toEqual(want);
    // A binding that already stands there (from before the gate): a second
    // host on it is a host put on this node all the same.
    const binding = await prisma.profileNodeBinding.create({ data: { profileId, nodeId, port: 443, transport: 'udp' } });
    expect(refusal(await post('/api/hosts', { bindingId: binding.id, remark: 'h2' }))).toEqual(want);
  });

  it('an FQDN address: let through', async () => {
    const nodeId = await node('hy.example.com:1337');
    const res = await post('/api/bindings', { profileId: await profile(), nodeId, port: 443 });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('hysteria on sing-box on an IP: let through, it brings its own certificate', async () => {
    const nodeId = await node('46.149.66.235:1337');
    const res = await post('/api/bindings', { profileId: await profile('singbox'), nodeId, port: 443 });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('moving a deployed profile off sing-box onto the native core is refused on an IP node', async () => {
    const nodeId = await node('46.149.66.235:1337');
    const profileId = await profile('singbox');
    expect((await post('/api/bindings', { profileId, nodeId, port: 443 })).statusCode).toBe(201);
    const res = await app.inject({ method: 'PUT', url: `/api/profiles/${profileId}`, headers: auth(), payload: { engine: null } });
    expect(refusal(res)).toEqual({
      status: 409,
      body: expect.objectContaining({ error: 'HYSTERIA_NEEDS_HOSTNAME', address: '46.149.66.235:1337' }),
    });
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })).engine).toBe('singbox');
  });
});
