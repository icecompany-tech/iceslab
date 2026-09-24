import { createHash } from 'node:crypto';
import {
  GEO_BUILTIN,
  GEO_BUILTIN_NAMES,
  GEO_FILE_MAX_BYTES,
  GEO_SET_KINDS,
  geoBuiltinUrl,
  type GeoBuiltinRelease,
  type GeoSetFormat,
  type GeoSetKind,
} from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { getLogger } from '../../lib/infra/logger.js';
import { GeoDatError, geoTagList, parseGeoDat } from './geo-dat.js';
import { toGeoDat } from './geo-formats.js';

/**
 * Where a geo set's files come in and become versions. Everything that ends in
 * `verified` goes through ingestGeoFile, whatever the source: the check is one
 * code path, so a URL, an upload and a built-in release cannot be held to
 * different standards.
 *
 * The status on the set is the LAST attempt; `current` moves only on success.
 * A broken refresh therefore leaves the nodes' list exactly where it was.
 */

export type IngestOutcome = { status: 'verified'; versionId: string } | { status: 'broken'; error: string };

export interface IngestInput {
  bytes: Uint8Array;
  /** The version label: a built-in's release tag. Otherwise the first 12 hex
   *  of the sha256 of the file as it came. */
  version?: string;
  /** What the source vouches for (a release manifest, a sidecar, the
   *  operator), about the file AS IT CAME. Without it only the parse stands
   *  between a cut file and a node, and a file cut exactly on an entry
   *  boundary parses. */
  expectedSha256?: string;
  /** The validators of the response a URL set's file came in, kept on the
   *  version for the next conditional request. */
  etag?: string | null;
  lastModified?: string | null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const MB = 1024 * 1024;

/**
 * Checks `bytes` as the set's kind and, when they hold, makes them the set's
 * current version. Never throws for a bad file: that is `broken`, in words.
 *
 * Phase 9.4: the file may be a v2fly `.dat`, a sing-box rule-set JSON or a
 * MaxMind database, recognised by its bytes (geo-formats.ts). The sha256 the
 * source vouches for is checked against the file as it came; what is stored
 * and laid out is the `.dat` it becomes, so every reader downstream sees one
 * format.
 */
export async function ingestGeoFile(setId: string, input: IngestInput): Promise<IngestOutcome> {
  const set = await prisma.geoSet.findUniqueOrThrow({ where: { id: setId }, select: { kind: true, name: true } });
  const kind = set.kind as GeoSetKind;
  const { bytes } = input;

  if (bytes.length > GEO_FILE_MAX_BYTES) {
    return markBroken(setId, `the file is ${(bytes.length / MB).toFixed(1)} MB, the ceiling is ${GEO_FILE_MAX_BYTES / MB} MB`);
  }
  const sourceSha256 = sha256Hex(bytes);
  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sourceSha256) {
    return markBroken(setId, `sha256 of the file is ${sourceSha256}, expected ${input.expectedSha256.toLowerCase()}`);
  }
  let dat: Uint8Array;
  let format: GeoSetFormat;
  let tags;
  try {
    ({ dat, format } = toGeoDat(bytes, kind, set.name));
    tags = geoTagList(parseGeoDat(dat, kind));
  } catch (err) {
    if (err instanceof GeoDatError) return markBroken(setId, err.message);
    throw err;
  }
  if (dat.length > GEO_FILE_MAX_BYTES) {
    return markBroken(setId, `converted to a .dat the list is ${(dat.length / MB).toFixed(1)} MB, the ceiling is ${GEO_FILE_MAX_BYTES / MB} MB`);
  }
  const sha256 = format === 'dat' ? sourceSha256 : sha256Hex(dat);

  const version = input.version ?? sourceSha256.slice(0, 12);
  const now = new Date();
  let versionId: string;
  try {
    // The bytes first and on their own. Writing the 23 MB geoip.dat took
    // 9.7 s on the dev machine (24.09), past the 5 s an interactive
    // transaction gets, and inside one it failed the whole ingest. Outside it
    // nothing is lost: the row is keyed by its content, a second write of the
    // same bytes is a no-op, and a blob no version names is only garbage.
    await prisma.geoBlob.createMany({
      data: [{ sha256, data: Buffer.from(dat), sizeBytes: dat.length }],
      skipDuplicates: true,
    });
    versionId = await publishVersion(setId, {
      version,
      sha256,
      sourceSha256,
      sizeBytes: dat.length,
      now,
      tags,
      format,
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
    });
  } catch (err) {
    // Not a bad file, and still never left at `checking`: the set says what
    // went wrong on this side.
    return markBroken(setId, `could not store the file: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { status: 'verified', versionId };
}

async function publishVersion(
  setId: string,
  v: {
    version: string;
    sha256: string;
    sourceSha256: string;
    sizeBytes: number;
    now: Date;
    tags: unknown;
    format: GeoSetFormat;
    etag: string | null;
    lastModified: string | null;
  },
): Promise<string> {
  const { version, sha256, sourceSha256, sizeBytes, now, tags, format, etag, lastModified } = v;
  return prisma.$transaction(async (tx) => {
    const row = await tx.geoSetVersion.upsert({
      where: { geoSetId_sha256: { geoSetId: setId, sha256 } },
      create: {
        geoSetId: setId,
        version,
        sha256,
        sourceSha256,
        sizeBytes,
        fetchedAt: now,
        tags: tags as Prisma.InputJsonValue,
        etag,
        lastModified,
      },
      // The same content fetched again: the label, the date and the
      // validators follow the latest fetch, the row (and every pin on it)
      // stays.
      update: { version, fetchedAt: now, etag, lastModified },
      select: { id: true },
    });
    await tx.geoSet.update({
      where: { id: setId },
      data: { currentVersionId: row.id, status: 'verified', checkedAt: now, error: null, format },
    });
    return row.id;
  });
}
export async function markBroken(setId: string, error: string): Promise<IngestOutcome> {
  await prisma.geoSet.update({
    where: { id: setId },
    data: { status: 'broken', checkedAt: new Date(), error },
  });
  return { status: 'broken', error };
}

export async function markChecking(setId: string): Promise<void> {
  await prisma.geoSet.update({ where: { id: setId }, data: { status: 'checking' } });
}

/**
 * The two built-in sets exist on every panel. Created on start and never by a
 * migration, so a suite that truncates gets them back the way production does.
 * An existing row is left alone: its status and versions are its history.
 */
export async function ensureBuiltinSets(): Promise<void> {
  await prisma.geoSet.createMany({
    data: GEO_SET_KINDS.map((kind) => ({
      name: GEO_BUILTIN_NAMES[kind],
      kind,
      sourceType: 'builtin',
      sourceTag: GEO_BUILTIN[kind].tag,
      status: 'checking',
    })),
    skipDuplicates: true,
  });
}

/**
 * Downloads an operator's set from its URL and ingests it against the sha256
 * its source vouches for: the one the operator typed (`manual`), or the first
 * 64 hex of `<url>.sha256sum` (`sidecar`, the way v2fly and most list
 * publishers ship them). A sidecar that cannot be read is `broken`: a file
 * nobody vouched for is not quietly taken on the parse alone.
 *
 * Conditional (phase 9.4): the validators of the current version go out as
 * If-None-Match and If-Modified-Since. A 304 is "nothing new": no version, no
 * `checking`, only `checkedAt` moves, and a status the "refresh now" button
 * set to `checking` goes back to what the current version is. The sidecar is
 * read only when the file itself came back new.
 *
 * A failure of the network is `broken` in words and leaves `current` where
 * it is; the scheduler asks again.
 */
export async function fetchUrl(
  setId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestOutcome | { status: 'unchanged' }> {
  const set = await prisma.geoSet.findUniqueOrThrow({
    where: { id: setId },
    select: {
      url: true,
      sha256Source: true,
      sha256Manual: true,
      current: { select: { etag: true, lastModified: true } },
    },
  });
  if (!set.url) return markBroken(setId, 'the set has no URL');
  const url = set.url;

  const conditional: Record<string, string> = {};
  if (set.current?.etag) conditional['If-None-Match'] = set.current.etag;
  if (set.current?.lastModified) conditional['If-Modified-Since'] = set.current.lastModified;

  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: 'follow', headers: conditional, signal: AbortSignal.timeout(600_000) });
  } catch (err) {
    return markBroken(setId, `download failed: ${err instanceof Error ? err.message : String(err)} (${url})`);
  }
  if (res.status === 304 && set.current) {
    await prisma.geoSet.update({
      where: { id: setId },
      data: { status: 'verified', error: null, checkedAt: new Date() },
    });
    return { status: 'unchanged' };
  }
  if (!res.ok) return markBroken(setId, `download failed: HTTP ${res.status} from ${url}`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return markBroken(setId, `download failed: ${err instanceof Error ? err.message : String(err)} (${url})`);
  }

  let expected: string;
  if (set.sha256Source === 'manual') {
    if (!set.sha256Manual) return markBroken(setId, 'sha256 is set to manual and none was given');
    expected = set.sha256Manual;
  } else {
    let side: Uint8Array;
    try {
      const s = await fetchImpl(`${url}.sha256sum`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!s.ok) return markBroken(setId, `sidecar sha256 not read: HTTP ${s.status} from ${url}.sha256sum`);
      side = new Uint8Array(await s.arrayBuffer());
    } catch (err) {
      return markBroken(setId, `sidecar sha256 not read: ${err instanceof Error ? err.message : String(err)} (${url}.sha256sum)`);
    }
    const hex = /^\s*([0-9a-fA-F]{64})\b/.exec(new TextDecoder().decode(side.subarray(0, 512)))?.[1];
    if (!hex) return markBroken(setId, `sidecar ${url}.sha256sum does not start with a sha256`);
    expected = hex.toLowerCase();
  }

  return ingestGeoFile(setId, {
    bytes,
    expectedSha256: expected,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  });
}

/**
 * Whether a URL set is due a scheduled fetch at `now`: never fetched, or its
 * `refreshHours` gone by since the last attempt. A broken attempt is retried
 * sooner, after an hour (or `refreshHours` when that is shorter): a network
 * that was down should not cost a day, and a list that is broken for good
 * should not be downloaded every tick either.
 */
export function urlSetDue(
  s: { status: string; checkedAt: Date | null; refreshHours: number | null },
  now: Date,
): boolean {
  if (!s.checkedAt) return true;
  const hours = s.refreshHours ?? 24;
  const wait = s.status === 'broken' ? Math.min(hours, 1) : hours;
  return now.getTime() - s.checkedAt.getTime() >= wait * 3_600_000;
}
/** Whether the built-in set of `kind` still has to fetch its pinned release. */
export async function builtinNeedsFetch(kind: GeoSetKind, release: GeoBuiltinRelease = GEO_BUILTIN[kind]): Promise<boolean> {
  const set = await prisma.geoSet.findUnique({
    where: { name: GEO_BUILTIN_NAMES[kind] },
    select: { current: { select: { sha256: true } } },
  });
  return set?.current?.sha256 !== release.sha256;
}

/**
 * Fetches the pinned release of a built-in set and ingests it against the
 * manifest's sha256. Nothing is fetched when the set already stands on that
 * content. A failed download is `broken` with the reason; the previous
 * current, if any, stays.
 *
 * `release` and `fetchImpl` are for tests; production passes neither.
 */
export async function fetchBuiltin(
  kind: GeoSetKind,
  release: GeoBuiltinRelease = GEO_BUILTIN[kind],
  fetchImpl: typeof fetch = fetch,
): Promise<IngestOutcome | { status: 'unchanged' }> {
  await ensureBuiltinSets();
  const set = await prisma.geoSet.findUniqueOrThrow({
    where: { name: GEO_BUILTIN_NAMES[kind] },
    select: { id: true },
  });
  if (!(await builtinNeedsFetch(kind, release))) return { status: 'unchanged' };

  const url = geoBuiltinUrl(release);
  await markChecking(set.id);
  let bytes: Uint8Array;
  try {
    // Ten minutes: geoip.dat is 23 MB, and on the dev machine 24.09 two
    // minutes were not enough for it. A background job can wait.
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(600_000) });
    if (!res.ok) return markBroken(set.id, `download failed: HTTP ${res.status} from ${url}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return markBroken(set.id, `download failed: ${err instanceof Error ? err.message : String(err)} (${url})`);
  }
  const out = await ingestGeoFile(set.id, { bytes, version: release.tag, expectedSha256: release.sha256 });
  if (out.status === 'verified') {
    await prisma.geoSet.update({ where: { id: set.id }, data: { sourceTag: release.tag } });
  }
  getLogger().info(`[geo] built-in ${kind} ${release.tag}: ${out.status}${out.status === 'broken' ? `, ${out.error}` : ''}`);
  return out;
}
