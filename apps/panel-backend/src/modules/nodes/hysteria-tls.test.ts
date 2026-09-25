import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import type { HysteriaInboundCfg } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { fetchEnabledInbounds } from '../inbounds/inbounds.queue.js';
import { certSha256, mintHysteriaTls } from './hysteria-tls.js';
import { hysteriaPinFor, readHysteriaTls } from './hysteria-tls-shape.js';

/**
 * E30a, 25.09: native hysteria on a node addressed by IP, where no public CA
 * issues. The panel mints a self-signed pair per node, pushes it to the agent
 * in the hysteria inbound, shows its fingerprint on the node, and every
 * subscription format pins it. A node with an FQDN keeps ACME and no pin;
 * hysteria on sing-box brings its own certificate. E30b's gate is gone.
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
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: auth(), payload });
const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: auth() });
  return { status: res.statusCode, text: res.body };
};

async function node(address: string): Promise<{ id: string; name: string }> {
  seq += 1;
  const name = `hy-${seq}`;
  const res = await post('/api/nodes', { name, address, intendedEngines: ['hysteria', 'singbox'] });
  expect(res.statusCode, res.body).toBe(201);
  return { id: JSON.parse(res.body).id as string, name };
}

async function hysteriaOn(nodeId: string, engine?: 'singbox'): Promise<void> {
  seq += 1;
  const p = await post('/api/profiles', { name: `hy-p-${seq}`, protocol: 'hysteria', config: {}, ...(engine ? { engine } : {}) });
  expect(p.statusCode, p.body).toBe(201);
  const b = await post('/api/bindings', { profileId: JSON.parse(p.body).id, nodeId, port: 443 });
  expect(b.statusCode, b.body).toBe(201);
}

const hyConfig = async (nodeId: string) =>
  (await fetchEnabledInbounds(nodeId)).find((i) => i.protocol === 'hysteria')!.config as HysteriaInboundCfg;

describe('the pair the panel mints', () => {
  it('is a leaf for the IP, its key matches, and certSha256 is the DER fingerprint', async () => {
    const t = await mintHysteriaTls('46.149.66.235');
    const cert = new X509Certificate(t.certPem);
    expect(cert.subjectAltName).toBe('IP Address:46.149.66.235');
    expect(cert.ca).toBe(false);
    expect(cert.checkPrivateKey(createPrivateKey(t.keyPem))).toBe(true);
    expect(t.certSha256).toBe(cert.fingerprint256.replace(/:/g, '').toLowerCase());
    expect(t.certSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 24 * 3600 * 1000);
    expect(certSha256(t.certPem)).toBe(t.certSha256);
  });
});

describe('the push', () => {
  it('a node on an IP: native hysteria gets the pair, the same one on every push, stored once', async () => {
    const n = await node('46.149.66.235:1337');
    await hysteriaOn(n.id);
    const first = await hyConfig(n.id);
    expect(first.hostname).toBeUndefined();
    expect(first.tlsCertPem).toMatch(/BEGIN CERTIFICATE/);
    expect(first.tlsKeyPem).toMatch(/BEGIN PRIVATE KEY/);
    const again = await hyConfig(n.id);
    expect(again.tlsCertPem).toBe(first.tlsCertPem);
    const stored = readHysteriaTls((await prisma.node.findUniqueOrThrow({ where: { id: n.id } })).hysteriaTls);
    expect(stored).toMatchObject({ host: '46.149.66.235', certSha256: certSha256(first.tlsCertPem!) });
  });

  it('a node with an FQDN: ACME by name, no pair, nothing stored', async () => {
    const n = await node('hy.example.com:1337');
    await hysteriaOn(n.id);
    const cfg = await hyConfig(n.id);
    expect(cfg).toMatchObject({ hostname: 'hy.example.com' });
    expect(cfg.tlsCertPem).toBeUndefined();
    expect((await prisma.node.findUniqueOrThrow({ where: { id: n.id } })).hysteriaTls).toBeNull();
  });

  it('hysteria on sing-box on an IP: no pair, sing-box brings its own', async () => {
    const n = await node('46.149.66.235:1337');
    await hysteriaOn(n.id, 'singbox');
    expect((await hyConfig(n.id)).tlsCertPem).toBeUndefined();
  });

  it('a node that moves to another IP gets a pair for the new one', async () => {
    const n = await node('46.149.66.235:1337');
    await hysteriaOn(n.id);
    const before = await hyConfig(n.id);
    await prisma.node.update({ where: { id: n.id }, data: { address: '46.149.66.236:1337' } });
    const after = await hyConfig(n.id);
    expect(after.tlsCertPem).not.toBe(before.tlsCertPem);
    expect(new X509Certificate(after.tlsCertPem!).subjectAltName).toBe('IP Address:46.149.66.236');
  });
});

describe('the node DTO and the rotation', () => {
  it('shows the fingerprint and never the key; rotating changes it; an FQDN node has nothing to rotate', async () => {
    const n = await node('46.149.66.235:1337');
    await hysteriaOn(n.id);
    const minted = certSha256((await hyConfig(n.id)).tlsCertPem!);
    const dto = JSON.parse((await get(`/api/nodes/${n.id}`)).text);
    expect(dto.hysteriaTls).toEqual({ certSha256: minted, host: '46.149.66.235', createdAt: expect.any(String) });
    expect(JSON.stringify(dto)).not.toContain('PRIVATE KEY');

    const rotated = await post(`/api/nodes/${n.id}/hysteria-tls/rotate`);
    expect(rotated.statusCode, rotated.body).toBe(200);
    const next = JSON.parse(rotated.body).hysteriaTls.certSha256 as string;
    expect(next).not.toBe(minted);
    expect(certSha256((await hyConfig(n.id)).tlsCertPem!)).toBe(next);

    const fqdn = await node('hy.example.com:1337');
    const refused = await post(`/api/nodes/${fqdn.id}/hysteria-tls/rotate`);
    expect(refused.statusCode).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({ error: 'HYSTERIA_TLS_NOT_SELF_SIGNED' });
  });

  it('the list names the new fields', async () => {
    const body = JSON.parse((await get('/api/nodes')).text);
    expect(body.fields).toEqual(expect.arrayContaining(['hysteriaTls', 'cores[].tls']));
  });
});

describe('every subscription format pins it, in its own field', () => {
  async function subscribe(address: string): Promise<{ token: string; sha: string | null }> {
    const n = await node(address);
    await hysteriaOn(n.id);
    const cfg = await hyConfig(n.id);
    const res = await post('/api/users', { username: `u-${seq}` });
    expect(res.statusCode, res.body).toBe(201);
    return { token: JSON.parse(res.body).subscriptionToken, sha: cfg.tlsCertPem ? certSha256(cfg.tlsCertPem) : null };
  }
  const sub = async (token: string, format?: string) =>
    (await get(`/sub/${token}${format ? `?format=${format}` : ''}`)).text;

  it('a node on an IP', async () => {
    const { token, sha } = await subscribe('46.149.66.235:1337');
    expect(sha).toMatch(/^[0-9a-f]{64}$/);

    // hy2 URI: the hysteria client checks the chain before the pin, so a
    // self-signed pin needs insecure=1 beside it; the pin still refuses others.
    const plain = Buffer.from(await sub(token), 'base64').toString('utf8');
    const uri = new URL(plain.split('\n').find((l) => l.startsWith('hysteria2://'))!);
    expect(uri.searchParams.get('pinSHA256')).toBe(sha);
    expect(uri.searchParams.get('insecure')).toBe('1');

    // mihomo: fingerprint, no skip-cert-verify.
    const clash = await sub(token, 'clash');
    expect(clash).toContain(`    fingerprint: ${sha}`);
    expect(clash).not.toMatch(/type: hysteria2[\s\S]*?skip-cert-verify: true/);

    // sing-box: the certificate itself as the anchor, the name in its SAN, insecure off.
    const sb = JSON.parse(await sub(token, 'singbox')) as { outbounds: { type: string; tls?: Record<string, unknown> }[] };
    const hy = sb.outbounds.find((o) => o.type === 'hysteria2')!;
    expect(hy.tls).toMatchObject({ enabled: true, server_name: '46.149.66.235' });
    expect(certSha256((hy.tls!.certificate as string[]).join('\n'))).toBe(sha);
    expect(hy.tls!.insecure).toBeUndefined();

    // xray: pinnedPeerCertSha256 and the SAN name. Hysteria rides only in the
    // array form; the flat one is VLESS-only by design.
    const xj = await sub(token, 'xrayjson-array');
    expect(xj).toMatch(new RegExp(`"pinnedPeerCertSha256":\\s*"${sha}"`));
    expect(xj).toMatch(/"serverName":\s*"46\.149\.66\.235"/);

    expect(await sub(token, 'surge')).toContain(`server-cert-fingerprint-sha256=${sha}`);
    expect(await sub(token, 'loon')).toContain(`tls-cert-sha256=${sha}`);
  });

  it('a node with an FQDN: no pin anywhere', async () => {
    const { token } = await subscribe('hy.example.com:1337');
    const plain = Buffer.from(await sub(token), 'base64').toString('utf8');
    expect(plain).not.toContain('pinSHA256');
    expect(plain).not.toContain('insecure=1');
    for (const f of ['clash', 'singbox', 'xrayjson-array', 'surge', 'loon']) {
      const body = await sub(token, f);
      for (const field of ['fingerprint:', 'pinnedPeerCertSha256', 'server-cert-fingerprint-sha256', 'tls-cert-sha256', '"certificate"']) {
        expect(body, `${f}: ${field}`).not.toContain(field);
      }
    }
  });
});

describe('hysteriaPinFor', () => {
  it('pins only native hysteria, on the address the pair was minted for', async () => {
    const t = await mintHysteriaTls('46.149.66.235');
    const pin = { certSha256: t.certSha256, certPem: t.certPem, serverName: '46.149.66.235' };
    expect(hysteriaPinFor('hysteria', '46.149.66.235:1337', t)).toEqual(pin);
    expect(hysteriaPinFor('singbox', '46.149.66.235:1337', t)).toBeNull();
    expect(hysteriaPinFor('hysteria', 'hy.example.com:1337', t)).toBeNull();
    // Moved and not pushed yet: a pin for the old certificate would not match.
    expect(hysteriaPinFor('hysteria', '46.149.66.236:1337', t)).toBeNull();
    expect(hysteriaPinFor('hysteria', '46.149.66.235:1337', null)).toBeNull();
  });
});
