import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { ROOT, datFile, domain, site } from '../../../tests/helpers/geo-dat.js';
import { GEO_FILE_MAX_BYTES } from '@iceslab/shared';
import { sha256Hex } from './geo-sets.store.js';
import { geoSetsQueue } from './geo-sets.queue.js';

/**
 * Phase 9.1g: a geo set from a file the operator uploads, multipart, up to
 * GEO_FILE_MAX_BYTES. Checked in the request; the answer is the set as the
 * check left it, with the computed sha256 for the operator to compare.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  vi.spyOn(geoSetsQueue, 'add').mockResolvedValue({} as never);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

afterAll(async () => {
  await geoSetsQueue.close();
  await prisma.$disconnect();
  await closeRedis();
});

/** A multipart body the way a browser's FormData sends it. */
function multipart(fields: Record<string, string>, file?: { name: string; bytes: Uint8Array }) {
  const boundary = '----iceslab-test-boundary';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(file.bytes),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const send = async (method: 'POST' | 'PUT', url: string, body: ReturnType<typeof multipart>) => {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...body.headers },
    payload: body.payload,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const lists = datFile(site('ADS', domain(ROOT, 'a.com')), site('RU', domain(ROOT, 'b.ru')));

describe('uploading a geo set', () => {
  it('checks the file in the request and answers with its computed sha256', async () => {
    const { status, body } = await send(
      'POST',
      '/api/geo-sets/upload',
      multipart({ name: 'mylist', kind: 'geosite' }, { name: 'my list.dat', bytes: lists }),
    );
    expect(status).toBe(202);
    expect(body).toMatchObject({
      name: 'mylist',
      kind: 'geosite',
      source: { type: 'upload', filename: 'my list.dat' },
      status: 'verified',
      current: { sha256: sha256Hex(lists), sizeBytes: lists.length, tagCount: 2 },
    });
  });

  it('takes a file past the body limit the rest of the API has', async () => {
    // Fastify's own bodyLimit (1 MiB) is not in the way of a multipart file:
    // 3 MB of one entry, the shape a real list has.
    const one = Uint8Array.from(domain(ROOT, 'example.com'));
    const n = Math.ceil((3 * 1024 * 1024) / one.length);
    const body = Buffer.concat([Buffer.from([0x0a, 3, 0x41, 0x44, 0x53]), ...Array.from({ length: n }, () => Buffer.from(one))]);
    const len: number[] = [];
    for (let x = body.length; ; x = Math.floor(x / 128)) {
      if (x < 128) {
        len.push(x);
        break;
      }
      len.push((x % 128) | 0x80);
    }
    const file = Buffer.concat([Buffer.from([0x0a, ...len]), body]);
    const { status, body: set } = await send('POST', '/api/geo-sets/upload', multipart({ name: 'big', kind: 'geosite' }, { name: 'big.dat', bytes: file }));
    expect(status).toBe(202);
    expect(set).toMatchObject({ status: 'verified', current: { sizeBytes: file.length } });
  }, 60_000);

  it('holds the file to a sha256 given beside it', async () => {
    const { status, body } = await send(
      'POST',
      '/api/geo-sets/upload',
      multipart({ name: 'mylist', kind: 'geosite', sha256: 'ab'.repeat(32) }, { name: 'l.dat', bytes: lists }),
    );
    expect(status).toBe(202);
    expect(body).toMatchObject({ status: 'broken', current: null, error: expect.stringMatching(/^sha256 of the file is/) });
  });

  it('refuses in words: no file, a name that is taken or reserved, a bad kind, a file past the ceiling', async () => {
    const noFile = await send('POST', '/api/geo-sets/upload', multipart({ name: 'mylist', kind: 'geosite' }));
    expect(noFile).toMatchObject({ status: 400, body: { error: 'GEO_SET_INVALID', reason: 'file' } });

    const notMultipart = await app.inject({
      method: 'POST',
      url: '/api/geo-sets/upload',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'mylist', kind: 'geosite' },
    });
    expect(notMultipart.statusCode).toBe(400);
    expect(JSON.parse(notMultipart.body)).toMatchObject({ reason: 'file' });

    const reserved = await send('POST', '/api/geo-sets/upload', multipart({ name: 'geosite', kind: 'geosite' }, { name: 'l.dat', bytes: lists }));
    expect(reserved.body).toMatchObject({ error: 'GEO_SET_INVALID', reason: 'name-reserved' });

    const kind = await send('POST', '/api/geo-sets/upload', multipart({ name: 'x', kind: 'mmdb' }, { name: 'l.dat', bytes: lists }));
    expect(kind.body).toMatchObject({ error: 'GEO_SET_INVALID', reason: 'kind' });

    await send('POST', '/api/geo-sets/upload', multipart({ name: 'mylist', kind: 'geosite' }, { name: 'l.dat', bytes: lists }));
    const taken = await send('POST', '/api/geo-sets/upload', multipart({ name: 'mylist', kind: 'geosite' }, { name: 'l.dat', bytes: lists }));
    expect(taken).toMatchObject({ status: 409, body: { error: 'GEO_SET_NAME_TAKEN' } });

    const big = await send(
      'POST',
      '/api/geo-sets/upload',
      multipart({ name: 'big', kind: 'geosite' }, { name: 'big.dat', bytes: new Uint8Array(GEO_FILE_MAX_BYTES + 1) }),
    );
    expect(big).toMatchObject({ status: 400, body: { error: 'GEO_SET_INVALID', reason: 'too-large' } });
    expect(await prisma.geoSet.count({ where: { name: 'big' } })).toBe(0);
  }, 60_000);

  it('takes a new file for an uploaded set, and only for one', async () => {
    const created = (await send('POST', '/api/geo-sets/upload', multipart({ name: 'mylist', kind: 'geosite' }, { name: 'a.dat', bytes: lists }))).body;
    const next = datFile(site('ADS', domain(ROOT, 'a.com'), domain(ROOT, 'c.com')));
    const { status, body } = await send('PUT', `/api/geo-sets/${created.id}/file`, multipart({}, { name: 'b.dat', bytes: next }));
    expect(status).toBe(202);
    expect(body).toMatchObject({ source: { filename: 'b.dat' }, status: 'verified', current: { sha256: sha256Hex(next) } });
    expect(await prisma.geoSetVersion.count({ where: { geoSetId: created.id } })).toBe(2);

    const url = await app.inject({
      method: 'POST',
      url: '/api/geo-sets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'remote', kind: 'geosite', source: { type: 'url', url: 'https://example.com/x.dat', sha256Source: 'sidecar' } },
    });
    const remote = JSON.parse(url.body);
    const refused = await send('PUT', `/api/geo-sets/${remote.id}/file`, multipart({}, { name: 'b.dat', bytes: next }));
    expect(refused).toMatchObject({ status: 400, body: { reason: 'source-not-editable' } });
  });
});
