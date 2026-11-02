import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { config } from '../../config.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { getPanelClientFingerprint } from '../keygen/keygen.service.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NODE_PAYLOAD_FILE, installOf } from './nodes.service.js';

/**
 * A-295: the payload of node create carried the certificate and nothing
 * else, so an agent installed from it (--payload-file) refused to start: the
 * panel-client pin is fail-closed (apps/node/internal/server/server.go), and
 * without panelUrl / nodeId / heartbeatToken its heartbeat was off. Both
 * roads now build it in one place (node-payload.ts).
 */

const here = dirname(fileURLToPath(import.meta.url));
/** The json tags of the agent's Payload struct, read from its source. */
function agentPayloadKeys(): string[] {
  const go = readFileSync(resolve(here, '../../../../node/internal/payload/payload.go'), 'utf8');
  const struct = /type Payload struct \{([\s\S]*?)\n\}/.exec(go)?.[1];
  if (!struct) throw new Error('type Payload struct not found in payload.go');
  return [...struct.matchAll(/json:"([A-Za-z]+)/g)].map((m) => m[1]!).sort();
}

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

type Payload = Record<string, unknown> & {
  nodeCertPem: string;
  nodeKeyPem: string;
  caCertPem: string;
  panelUrl: string;
  nodeId: string;
  heartbeatToken: string;
  panelClientFingerprint: string;
};
const decode = (b64: string) => JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as Payload;

async function createNode(address: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: `pl-${address.replace(/[^A-Za-z0-9.-]/g, '-')}`, address, protocol: 'xray' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as {
    id: string;
    payload: string;
    bootstrap: { token: string; command: string; payloadOnly: boolean };
  };
}

describe('the node payload', () => {
  it('create and redeem give the same keys, every key of the agent\'s Payload, from one build', async () => {
    const keys = agentPayloadKeys();
    expect(keys).toEqual(
      ['caCertPem', 'coreVersions', 'heartbeatToken', 'nodeCertPem', 'nodeId', 'nodeKeyPem', 'panelClientFingerprint', 'panelUrl'],
    );
    const node = await createNode('203.0.113.21');
    const created = decode(node.payload);
    const redeem = await app.inject({ method: 'GET', url: `/api/internal/bootstrap/${node.bootstrap.token}` });
    expect(redeem.statusCode, redeem.body).toBe(200);
    const redeemed = decode(redeem.body);

    expect(Object.keys(created).sort()).toEqual(keys);
    expect(Object.keys(redeemed).sort()).toEqual(keys);
  });

  it('carries what the agent will not start or beat without: the three PEMs, the pin, the panel, the node, a working heartbeat token', async () => {
    const node = await createNode('203.0.113.22');
    const p = decode(node.payload);
    for (const k of ['nodeCertPem', 'nodeKeyPem', 'caCertPem'] as const) expect(p[k], k).toMatch(/-----BEGIN /);
    expect(p.panelClientFingerprint).toBe(await getPanelClientFingerprint());
    expect(p.panelUrl).toBe(config.PUBLIC_URL);
    expect(p.nodeId).toBe(node.id);

    // The agent's heartbeat, as it sends it (heartbeat.go): this token is taken.
    const beat = await app.inject({
      method: 'GET',
      url: '/api/internal/nodes/me/status',
      headers: { authorization: `Bearer ${p.heartbeatToken}` },
    });
    expect(beat.statusCode, beat.body).toBe(200);
    expect(JSON.parse(beat.body).status).toBe('active');
  });

  it('names the node in its certificate by IP or by DNS, as before', async () => {
    const byIp = new X509Certificate(decode((await createNode('203.0.113.23')).payload).nodeCertPem);
    expect(byIp.subjectAltName).toContain('IP Address:203.0.113.23');
    const byName = new X509Certificate(decode((await createNode('node-pl.example.com:443')).payload).nodeCertPem);
    expect(byName.subjectAltName).toContain('DNS:node-pl.example.com');
  });
});

describe('the install command on a panel without https', () => {
  it('http: the --payload-file command and payloadOnly, never a token redeem the installer refuses', async () => {
    const r = await installOf('http://203.0.113.5:3000', 'bs_test', '203.0.113.30', null, ['xray']);
    expect(r.payloadOnly).toBe(true);
    expect(r.command).toContain(`--payload-file ${NODE_PAYLOAD_FILE}`);
    expect(r.command).not.toContain('--bootstrap');
    expect(r.command).not.toContain('--panel-url');
  });

  it('https: the bootstrap command, payloadOnly false', async () => {
    const r = await installOf('https://panel.example.com', 'bs_test', '203.0.113.30', null, ['xray']);
    expect(r.payloadOnly).toBe(false);
    expect(r.command).toContain('--panel-url https://panel.example.com');
    expect(r.command).toContain('--bootstrap bs_test');
    expect(r.command).not.toContain('--payload-file');
  });

  it('node create and a refreshed bootstrap answer by the panel URL they run on', async () => {
    const https = config.PUBLIC_URL.startsWith('https://');
    const node = await createNode('203.0.113.24');
    expect(node.bootstrap.payloadOnly).toBe(!https);
    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/nodes/${node.id}/bootstrap`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(201);
    expect(JSON.parse(refreshed.body).payloadOnly).toBe(!https);
  });
});
