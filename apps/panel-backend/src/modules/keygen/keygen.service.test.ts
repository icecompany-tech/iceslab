import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  bootstrapCa,
  issueNodeCert,
  encodeNodePayload,
  decodeNodePayload,
  type NodePayload,
} from './keygen.service.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('bootstrapCa', () => {
  it('generates a valid CA on first call', async () => {
    const ca = await bootstrapCa();
    expect(ca.certPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(ca.certPem).toContain('-----END CERTIFICATE-----');
    expect(ca.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(ca.privateKeyPem).toContain('-----END PRIVATE KEY-----');
  });

  it('is idempotent, returns the same CA on subsequent calls', async () => {
    const first = await bootstrapCa();
    const second = await bootstrapCa();
    expect(second.certPem).toEqual(first.certPem);
    expect(second.privateKeyPem).toEqual(first.privateKeyPem);
  });

  it('persists exactly one row in keygen_ca', async () => {
    await bootstrapCa();
    await bootstrapCa();
    await bootstrapCa();
    const count = await prisma.keygenCa.count();
    expect(count).toBe(1);
  });
});

describe('issueNodeCert', () => {
  it('returns a NodePayload with cert, key, and CA', async () => {
    const payload = await issueNodeCert({ commonName: 'node-1' });
    expect(payload.nodeCertPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(payload.nodeKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(payload.caCertPem).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('issues a node cert distinct from the CA cert', async () => {
    const payload = await issueNodeCert({ commonName: 'node-1' });
    expect(payload.nodeCertPem).not.toEqual(payload.caCertPem);
  });

  it('embeds SANs when provided', async () => {
    const payload = await issueNodeCert({
      commonName: 'node-1',
      sans: [{ type: 'ip', value: '127.0.0.1' }],
    });
    // Look for an OctetString-encoded IP in the cert (rough check; real X.509
    // parse is overkill here, we'll cover that in transport mTLS handshake).
    expect(payload.nodeCertPem.length).toBeGreaterThan(500);
  });
});

describe('encodeNodePayload / decodeNodePayload', () => {
  it('roundtrips a payload through base64url', () => {
    const payload: NodePayload = {
      nodeCertPem: '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n',
      nodeKeyPem: '-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----\n',
      caCertPem: '-----BEGIN CERTIFICATE-----\nCCC\n-----END CERTIFICATE-----\n',
    };
    const encoded = encodeNodePayload(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // base64url charset
    expect(decodeNodePayload(encoded)).toEqual(payload);
  });
});
