import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { GeoBuiltinRelease } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { ROOT, cidr, datFile, domain, geoip, site } from '../../../tests/helpers/geo-dat.js';
import { ensureBuiltinSets, fetchBuiltin, fetchUrl, ingestGeoFile, sha256Hex, urlSetDue } from './geo-sets.store.js';
import { buildMmdb, country } from '../../../tests/helpers/mmdb.js';

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

describe('a set fetched from a URL', () => {
  const URL_ = 'https://lists.example.com/mine.dat';
  async function urlSet(sha256Source: 'sidecar' | 'manual', sha256Manual: string | null = null) {
    return prisma.geoSet.create({
      data: { name: 'mine', kind: 'geosite', sourceType: 'url', url: URL_, sha256Source, sha256Manual },
      select: { id: true },
    });
  }
  /** Serves the file and, when given, its sidecar; everything else 404. */
  const site_ = (sidecar: string | null): typeof fetch =>
    (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === URL_) return new Response(Buffer.from(good));
      if (u === `${URL_}.sha256sum` && sidecar !== null) return new Response(sidecar);
      return new Response(null, { status: 404 });
    }) as typeof fetch;

  it('takes the sha256 from the sidecar next to the file', async () => {
    const { id } = await urlSet('sidecar');
    expect((await fetchUrl(id, site_(`${sha256Hex(good)}  mine.dat\n`))).status).toBe('verified');
  });

  it('a sidecar that is missing or says nothing is broken, not skipped', async () => {
    const { id } = await urlSet('sidecar');
    expect(await fetchUrl(id, site_(null))).toEqual({
      status: 'broken',
      error: `sidecar sha256 not read: HTTP 404 from ${URL_}.sha256sum`,
    });
    expect(await fetchUrl(id, site_('<html>not found</html>'))).toEqual({
      status: 'broken',
      error: `sidecar ${URL_}.sha256sum does not start with a sha256`,
    });
  });

  it('a manual sha256 the file does not have', async () => {
    const { id } = await urlSet('manual', 'cd'.repeat(32));
    expect(await fetchUrl(id, site_(null))).toMatchObject({ status: 'broken', error: expect.stringMatching(/^sha256 of the file is/) });
  });
});

describe('refreshing a URL set, conditionally (phase 9.4)', () => {
  const URL_ = 'https://lists.example.com/cond.dat';
  async function urlSet() {
    return prisma.geoSet.create({
      data: { name: 'cond', kind: 'geosite', sourceType: 'url', url: URL_, sha256Source: 'manual', sha256Manual: sha256Hex(good) },
      select: { id: true },
    });
  }
  /** A server that remembers what it was asked and answers 304 to a match. */
  function server() {
    const asked: Record<string, string>[] = [];
    const f = (async (_input: string | URL | Request, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      asked.push(h);
      if (h['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
      return new Response(Buffer.from(good), { headers: { etag: '"v1"', 'last-modified': 'Wed, 23 Sep 2026 10:00:00 GMT' } });
    }) as typeof fetch;
    return { f, asked };
  }

  it('keeps the validators and sends them back; a 304 is nothing new, not even checking', async () => {
    const { id } = await urlSet();
    const s = server();
    expect((await fetchUrl(id, s.f)).status).toBe('verified');
    expect(s.asked[0]).toEqual({});
    const v = await prisma.geoSetVersion.findFirstOrThrow({ where: { geoSetId: id } });
    expect(v).toMatchObject({ etag: '"v1"', lastModified: 'Wed, 23 Sep 2026 10:00:00 GMT' });

    // "Refresh now" set it to checking; the 304 puts it back.
    await prisma.geoSet.update({ where: { id }, data: { status: 'checking' } });
    expect(await fetchUrl(id, s.f)).toEqual({ status: 'unchanged' });
    expect(s.asked[1]).toEqual({ 'If-None-Match': '"v1"', 'If-Modified-Since': 'Wed, 23 Sep 2026 10:00:00 GMT' });
    expect(await prisma.geoSetVersion.count({ where: { geoSetId: id } })).toBe(1);
    expect((await read(id)).status).toBe('verified');
  });

  it('a network that is down is broken in words, and the current list stays', async () => {
    const { id } = await urlSet();
    await fetchUrl(id, server().f);
    const down = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    expect(await fetchUrl(id, down)).toMatchObject({ status: 'broken', error: expect.stringMatching(/ECONNREFUSED/) });
    expect((await read(id)).current!.sha256).toBe(sha256Hex(good));
  });

  it('is due by its refreshHours, and after a failure within the hour', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    expect(urlSetDue({ status: 'checking', checkedAt: null, refreshHours: 24 }, now)).toBe(true);
    expect(urlSetDue({ status: 'verified', checkedAt: ago(23), refreshHours: 24 }, now)).toBe(false);
    expect(urlSetDue({ status: 'verified', checkedAt: ago(24), refreshHours: 24 }, now)).toBe(true);
    expect(urlSetDue({ status: 'verified', checkedAt: ago(6), refreshHours: null }, now)).toBe(false);
    expect(urlSetDue({ status: 'broken', checkedAt: ago(0.5), refreshHours: 24 }, now)).toBe(false);
    expect(urlSetDue({ status: 'broken', checkedAt: ago(1), refreshHours: 24 }, now)).toBe(true);
  });
});

describe('the other formats become a .dat (phase 9.4)', () => {
  it('a rule-set JSON: the file as it came vouched for, the .dat stored, one tag named after the set', async () => {
    const { id } = await userSet('mylist', 'geosite');
    const file = new TextEncoder().encode(JSON.stringify({ version: 2, rules: [{ domain_suffix: ['ads.example'] }] }));
    expect((await ingestGeoFile(id, { bytes: file, expectedSha256: sha256Hex(file) })).status).toBe('verified');
    const s = await prisma.geoSet.findUniqueOrThrow({
      where: { id },
      select: { format: true, current: { select: { sha256: true, sourceSha256: true, version: true, tags: true } } },
    });
    expect(s.format).toBe('rule-set-json');
    expect(s.current!.sourceSha256).toBe(sha256Hex(file));
    expect(s.current!.sha256).not.toBe(sha256Hex(file));
    expect(s.current!.version).toBe(sha256Hex(file).slice(0, 12));
    expect(s.current!.tags).toEqual([{ name: 'mylist', entries: 1, attrs: [] }]);
  });

  it('a MaxMind database into a geosite set is broken in words', async () => {
    const { id } = await userSet('mm', 'geosite');
    const db = buildMmdb(4, [{ ip: [1, 2, 3, 0], prefix: 24, data: country('RU') }]);
    expect(await ingestGeoFile(id, { bytes: db })).toEqual({
      status: 'broken',
      error: 'this is a MaxMind database, which is a geoip list, and the set is geosite',
    });
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
