import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { GeoBuiltinRelease } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { ROOT, cidr, datFile, domain, geoip, site } from '../../../tests/helpers/geo-dat.js';
import { ensureBuiltinSets, fetchBuiltin, ingestGeoFile, sha256Hex } from './geo-sets.store.js';

/**
 * Phase 9.1: how a file becomes a version. The status is the last attempt,
 * `current` moves only on success, and the bytes live beside the rows.
 */
beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const good = datFile(site('ADS', domain(ROOT, 'a.com'), domain(ROOT, 'b.com')), site('RU', domain(ROOT, 'c.ru')));
const better = datFile(site('ADS', domain(ROOT, 'a.com')));

async function userSet(name = 'mylist', kind = 'geosite') {
  return prisma.geoSet.create({
    data: { name, kind, sourceType: 'upload', filename: `${name}.dat` },
    select: { id: true },
  });
}

const read = (id: string) =>
  prisma.geoSet.findUniqueOrThrow({
    where: { id },
    select: { status: true, error: true, checkedAt: true, current: { select: { version: true, sha256: true, tags: true } } },
  });

describe('ingest', () => {
  it('a good file becomes current, verified, with its tags and its bytes', async () => {
    const { id } = await userSet();
    const out = await ingestGeoFile(id, { bytes: good });
    expect(out.status).toBe('verified');
    const s = await read(id);
    const sha = sha256Hex(good);
    expect(s).toMatchObject({ status: 'verified', error: null, current: { version: sha.slice(0, 12), sha256: sha } });
    expect(s.current!.tags).toEqual([
      { name: 'ads', entries: 2, attrs: [] },
      { name: 'ru', entries: 1, attrs: [] },
    ]);
    const blob = await prisma.geoBlob.findUniqueOrThrow({ where: { sha256: sha } });
    expect(Buffer.from(blob.data).equals(Buffer.from(good))).toBe(true);
  });

  it('a broken file after a good one: broken in words, current where it was', async () => {
    const { id } = await userSet();
    await ingestGeoFile(id, { bytes: good });
    const out = await ingestGeoFile(id, { bytes: good.subarray(0, good.length - 2) });
    expect(out).toMatchObject({ status: 'broken' });
    const s = await read(id);
    expect(s.status).toBe('broken');
    expect(s.error).toMatch(/^not a valid geosite file: .* \(byte \d+\)$/);
    expect(s.current!.sha256).toBe(sha256Hex(good));
  });

  it('a sha256 the source vouched for and the file does not have', async () => {
    const { id } = await userSet();
    const out = await ingestGeoFile(id, { bytes: good, expectedSha256: 'ab'.repeat(32) });
    expect(out).toEqual({
      status: 'broken',
      error: `sha256 of the file is ${sha256Hex(good)}, expected ${'ab'.repeat(32)}`,
    });
    expect((await read(id)).current).toBeNull();
  });

  it('a file of the other kind', async () => {
    const { id } = await userSet('ips', 'geoip');
    await ingestGeoFile(id, { bytes: good });
    expect((await read(id)).error).toBe('this is a geosite file, the set is geoip');
  });

  it('the same content twice is one version and one blob; new content is a second version', async () => {
    const { id } = await userSet();
    await ingestGeoFile(id, { bytes: good });
    await ingestGeoFile(id, { bytes: good });
    expect(await prisma.geoSetVersion.count({ where: { geoSetId: id } })).toBe(1);
    await ingestGeoFile(id, { bytes: better });
    expect(await prisma.geoSetVersion.count({ where: { geoSetId: id } })).toBe(2);
    expect(await prisma.geoBlob.count()).toBe(2);
    expect((await read(id)).current!.sha256).toBe(sha256Hex(better));
  });
});

describe('a file the size of the real geoip.dat', () => {
  /**
   * 24.09, live on the dev database: the 23 MB geoip.dat took 9.7 s to write
   * and failed the ingest from inside a 5 s transaction, which small fixtures
   * never come near. Built straight into one buffer: 2.4 million CIDRs as a
   * number[] would not fit in the test's memory.
   */
  function bigGeoip(targetBytes: number): Uint8Array {
    const one = Uint8Array.from(cidr([10, 0, 0, 0], 8));
    const code = Uint8Array.from([0x0a, 3, ...new TextEncoder().encode('BIG')]);
    const n = Math.ceil(targetBytes / one.length);
    const bodyLen = code.length + n * one.length;
    const len: number[] = [];
    for (let x = bodyLen; ; x = Math.floor(x / 128)) {
      if (x < 128) {
        len.push(x);
        break;
      }
      len.push((x % 128) | 0x80);
    }
    const out = new Uint8Array(1 + len.length + bodyLen);
    out.set([0x0a, ...len], 0);
    let at = 1 + len.length;
    out.set(code, at);
    at += code.length;
    for (let i = 0; i < n; i++, at += one.length) out.set(one, at);
    return out;
  }

  it('is stored and verified', { timeout: 120_000 }, async () => {
    const { id } = await userSet('big', 'geoip');
    const bytes = bigGeoip(24 * 1024 * 1024);
    const out = await ingestGeoFile(id, { bytes });
    expect(out.status).toBe('verified');
    expect((await read(id)).current!.sha256).toBe(sha256Hex(bytes));
  });
});

describe('pins hold a version, a whole set still goes', () => {
  async function pinned() {
    const { id } = await userSet();
    const out = await ingestGeoFile(id, { bytes: good });
    if (out.status !== 'verified') throw new Error('fixture');
    const node = await prisma.node.create({
      data: { name: 'ru-01', address: 'ru-01.example.com:1337', protocol: 'xray', heartbeatSecret: randomBytes(32) },
      select: { id: true },
    });
    await prisma.nodeGeoPin.create({ data: { nodeId: node.id, geoSetId: id, versionId: out.versionId } });
    return { setId: id, versionId: out.versionId };
  }

  it('a version a node stands on cannot be deleted', async () => {
    const { versionId } = await pinned();
    await expect(prisma.geoSetVersion.delete({ where: { id: versionId } })).rejects.toThrow();
  });

  it('deleting the set takes its pins and versions with it', async () => {
    const { setId } = await pinned();
    await prisma.geoSet.delete({ where: { id: setId } });
    expect(await prisma.nodeGeoPin.count()).toBe(0);
    expect(await prisma.geoSetVersion.count()).toBe(0);
  });

  it('the name the database takes is the one ext: can carry', async () => {
    await expect(
      prisma.geoSet.create({ data: { name: '../x', kind: 'geosite', sourceType: 'upload' } }),
    ).rejects.toThrow(/geo_sets_name_check/);
  });
});

describe('built-in sets', () => {
  const ipFile = datFile(geoip('PRIVATE', cidr([10, 0, 0, 0], 8)));
  const release: GeoBuiltinRelease = {
    repo: 'v2fly/geoip',
    tag: '202609050329',
    file: 'geoip.dat',
    sha256: sha256Hex(ipFile),
  };
  const serve = (body: Uint8Array | null, status = 200): typeof fetch =>
    (async () => new Response(body ? Buffer.from(body) : null, { status })) as typeof fetch;

  it('exist on every panel, once however often it starts', async () => {
    await ensureBuiltinSets();
    await ensureBuiltinSets();
    const rows = await prisma.geoSet.findMany({ select: { name: true, kind: true, sourceType: true }, orderBy: { name: 'asc' } });
    expect(rows).toEqual([
      { name: 'geoip', kind: 'geoip', sourceType: 'builtin' },
      { name: 'geosite', kind: 'geosite', sourceType: 'builtin' },
    ]);
  });

  it('fetch the pinned release, labelled by its tag, and not again once it is there', async () => {
    const out = await fetchBuiltin('geoip', release, serve(ipFile));
    expect(out.status).toBe('verified');
    const s = await prisma.geoSet.findUniqueOrThrow({ where: { name: 'geoip' }, select: { current: { select: { version: true } } } });
    expect(s.current!.version).toBe('202609050329');
    expect(await fetchBuiltin('geoip', release, serve(null, 500))).toEqual({ status: 'unchanged' });
  });

  it('a download that fails or does not match the manifest is broken, in words', async () => {
    expect(await fetchBuiltin('geoip', release, serve(null, 404))).toEqual({
      status: 'broken',
      error: 'download failed: HTTP 404 from https://github.com/v2fly/geoip/releases/download/202609050329/geoip.dat',
    });
    const other = datFile(geoip('PRIVATE', cidr([192, 168, 0, 0], 16)));
    const out = await fetchBuiltin('geoip', release, serve(other));
    expect(out).toMatchObject({ status: 'broken', error: expect.stringMatching(/^sha256 of the file is/) });
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com');
    }) as typeof fetch;
    expect(await fetchBuiltin('geoip', release, failing)).toMatchObject({
      error: expect.stringMatching(/^download failed: getaddrinfo ENOTFOUND github.com/),
    });
  });
});
