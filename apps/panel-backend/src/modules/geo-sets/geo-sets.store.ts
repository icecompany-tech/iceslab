import { createHash } from 'node:crypto';
import {
  GEO_BUILTIN,
  GEO_BUILTIN_NAMES,
  GEO_FILE_MAX_BYTES,
  GEO_SET_KINDS,
  geoBuiltinUrl,
  type GeoBuiltinRelease,
  type GeoSetKind,
} from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { getLogger } from '../../lib/infra/logger.js';
import { GeoDatError, geoTagList, parseGeoDat } from './geo-dat.js';

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
   *  of the sha256. */
  version?: string;
  /** What the source vouches for (a release manifest, a sidecar, the
   *  operator). Without it only the parse stands between a cut file and a
   *  node, and a file cut exactly on an entry boundary parses. */
  expectedSha256?: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const MB = 1024 * 1024;

/** Checks `bytes` as the set's kind and, when they hold, makes them the set's
 *  current version. Never throws for a bad file: that is `broken`, in words. */
export async function ingestGeoFile(setId: string, input: IngestInput): Promise<IngestOutcome> {
  const set = await prisma.geoSet.findUniqueOrThrow({ where: { id: setId }, select: { kind: true } });
  const { bytes } = input;

  if (bytes.length > GEO_FILE_MAX_BYTES) {
    return markBroken(setId, `the file is ${(bytes.length / MB).toFixed(1)} MB, the ceiling is ${GEO_FILE_MAX_BYTES / MB} MB`);
  }
  const sha256 = sha256Hex(bytes);
  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256) {
    return markBroken(setId, `sha256 of the file is ${sha256}, expected ${input.expectedSha256.toLowerCase()}`);
  }
  let tags;
  try {
    tags = geoTagList(parseGeoDat(bytes, set.kind as GeoSetKind));
  } catch (err) {
    if (err instanceof GeoDatError) return markBroken(setId, err.message);
    throw err;
  }

  const version = input.version ?? sha256.slice(0, 12);
  const now = new Date();
  let versionId: string;
  try {
    // The bytes first and on their own. Writing the 23 MB geoip.dat took
    // 9.7 s on the dev machine (24.09), past the 5 s an interactive
    // transaction gets, and inside one it failed the whole ingest. Outside it
    // nothing is lost: the row is keyed by its content, a second write of the
    // same bytes is a no-op, and a blob no version names is only garbage.
    await prisma.geoBlob.createMany({
      data: [{ sha256, data: Buffer.from(bytes), sizeBytes: bytes.length }],
      skipDuplicates: true,
    });
    versionId = await publishVersion(setId, { version, sha256, sizeBytes: bytes.length, now, tags });
  } catch (err) {
    // Not a bad file, and still never left at `checking`: the set says what
    // went wrong on this side.
    return markBroken(setId, `could not store the file: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { status: 'verified', versionId };
}

async function publishVersion(
  setId: string,
  v: { version: string; sha256: string; sizeBytes: number; now: Date; tags: unknown },
): Promise<string> {
  const { version, sha256, sizeBytes, now, tags } = v;
  return prisma.$transaction(async (tx) => {
    const row = await tx.geoSetVersion.upsert({
      where: { geoSetId_sha256: { geoSetId: setId, sha256 } },
      create: {
        geoSetId: setId,
        version,
        sha256,
        sizeBytes,
        fetchedAt: now,
        tags: tags as Prisma.InputJsonValue,
      },
      // The same content fetched again: the label and the date follow the
      // latest fetch, the row (and every pin on it) stays.
      update: { version, fetchedAt: now },
      select: { id: true },
    });
    await tx.geoSet.update({
      where: { id: setId },
      data: { currentVersionId: row.id, status: 'verified', checkedAt: now, error: null },
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
