import { createHash } from 'node:crypto';
import type { NodeGeo, NodeGeoFile, NodeGeoIntended } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { NodeRequestError, type NodeTransport } from '../nodes/nodes.transport.js';
import { chainRuleSetFileName, collectGeoUses, nodeFileName, type GeoUseSite } from './geo-refs.js';
import { GeoTagUnknownError, geoipRuleSet, geositeRuleSet, parseGeoDat, type GeoDatIndex } from './geo-dat.js';

/**
 * The `geo` of a push (phase 9.2, geo-contract.md sections 1, 2 and 7): which
 * files a node stands on, laid out on the agent before the push names them.
 *
 * Files follow the node's PINS, not the sets' current versions. A set a node
 * starts naming has no pin yet and is pinned to current on its first push:
 * no session there stands on it, so nothing is restarted behind anybody's
 * back. Everything after that moves only by a rollout.
 *
 * Two readers since phase 9.3. xray reads the set's `.dat`. The chain process
 * at a cascade ENTRY reads one rule-set JSON per tag its route policies name
 * (chain-policy.ts), built here from the same pinned version, so a tag is one
 * list of domains on both.
 */

/** A label for a set of files: the first 12 hex of the sha256 of their
 *  sorted "name sha256" lines. Only a label; comparison is by file. */
export function geoVersionOf(files: { name: string; sha256: string }[]): string {
  const lines = files.map((f) => `${f.name} ${f.sha256}\n`).sort();
  return createHash('sha256').update(lines.join('')).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------- chain rule-sets

interface Built {
  bytes: Buffer;
  sha256: string;
}

/** Parsed files by sha, a few at a time: the built-in geosite is 2.2 MB and
 *  every tag of one version is built from the same parse. */
const parsed = new Map<string, { buf: Uint8Array; index: GeoDatIndex }>();
/** Built rule-sets by (version sha, tag). Content-addressed, so never stale. */
const built = new Map<string, Built | null>();
const PARSED_KEEP = 4;
const BUILT_KEEP = 512;

async function parsedVersion(
  sha256: string,
  kind: 'geosite' | 'geoip' = 'geosite',
): Promise<{ buf: Uint8Array; index: GeoDatIndex }> {
  const key = `${kind}|${sha256}`;
  const hit = parsed.get(key);
  if (hit) return hit;
  const blob = await prisma.geoBlob.findUniqueOrThrow({ where: { sha256 }, select: { data: true } });
  const buf = new Uint8Array(blob.data);
  const entry = { buf, index: parseGeoDat(buf, kind) };
  if (parsed.size >= PARSED_KEEP) parsed.delete(parsed.keys().next().value!);
  parsed.set(key, entry);
  return entry;
}

/**
 * The chain's rule-set for one tag of one verified geosite version, or null
 * when the version has no such tag: the file is then not laid out, and the
 * chain config that names it fails `sing-box check` on the node in the
 * engine's words, the same as xray fails an `ext:` whose tag is gone.
 */
export async function chainRuleSet(
  versionSha: string,
  tag: string,
  kind: 'geosite' | 'geoip' = 'geosite',
): Promise<Built | null> {
  const key = `${kind}|${versionSha}|${tag}`;
  if (built.has(key)) return built.get(key)!;
  const { buf, index } = await parsedVersion(versionSha, kind);
  let out: Built | null;
  try {
    const rs = kind === 'geoip' ? geoipRuleSet(buf, index, tag) : geositeRuleSet(buf, index, tag);
    const bytes = Buffer.from(JSON.stringify(rs));
    out = { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) {
    if (!(err instanceof GeoTagUnknownError)) throw err;
    out = null;
  }
  if (built.size >= BUILT_KEEP) built.delete(built.keys().next().value!);
  built.set(key, out);
  return out;
}

/**
 * The tags the chain of `nodeId` reads, by set: those its route policies name
 * in their domain lists. Route policies reach exactly the entries of enabled
 * cascades (geo-refs.ts), which is where the chain carries them out.
 */
export function chainTagsFor(nodeId: string, sites: GeoUseSite[], cascadeExit = false): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const s of sites) {
    if (!s.nodeIds.includes(nodeId)) continue;
    // E53: the node policy of a cascade EXIT is carried out by its chain too,
    // domain lists and ip lists both (chainNodePolicyOf).
    // E55: a route policy's address entries too (geoip rule-sets).
    const read = s.owner.kind === 'route-policy' || (cascadeExit && s.owner.kind === 'node-policy');
    if (!read) continue;
    const tags = out.get(s.ref.set) ?? new Set<string>();
    tags.add(s.ref.tag.toLowerCase());
    out.set(s.ref.set, tags);
  }
  return new Map([...out].map(([set, tags]) => [set, [...tags].sort()]));
}

/** A file as the panel works with it; `publicIntended` is the DTO's cut. */
export type IntendedFile = NodeGeoIntended['files'][number] & {
  size: number;
  /** The set version it comes from, and for a chain file the tag. */
  versionSha: string;
  chainTag?: string;
  /** Which list a chain file is built from: a geoip set gives ip rule-sets. */
  chainKind?: 'geosite' | 'geoip';
};

/**
 * The files one version of one set puts on a node: its `.dat` for xray, and
 * for the chain one rule-set per tag in `chainTags` (geosite sets only; a
 * geoip set has nothing a domain list can name).
 */
export async function filesOfSet(
  set: { id: string; name: string; sourceType: string; kind: string },
  v: { version: string; sha256: string; sizeBytes: number },
  chainTags: string[],
): Promise<IntendedFile[]> {
  const base = { setId: set.id, setName: set.name, setVersion: v.version, versionSha: v.sha256 };
  const files: IntendedFile[] = [
    { name: nodeFileName(set), sha256: v.sha256, size: v.sizeBytes, reader: 'xray', ...base },
  ];
  if (set.kind !== 'geosite' && set.kind !== 'geoip') return files;
  for (const tag of chainTags) {
    const rs = await chainRuleSet(v.sha256, tag, set.kind);
    if (!rs) continue;
    files.push({
      name: chainRuleSetFileName(set.name, tag),
      sha256: rs.sha256,
      size: rs.bytes.length,
      reader: 'chain',
      chainTag: tag,
      chainKind: set.kind,
      ...base,
    });
  }
  return files;
}

// ---------------------------------------------------------------- the node

/**
 * What the node's rules need and where its pins stand. With `pinMissing` a
 * set the node names for the first time is pinned to its current version
 * (the push path); without, the pin is only read (the node card). A set with
 * no pin and no verified version has nothing to lay out and is left out: the
 * rule naming it fails on the node in the core's words, which is the truth.
 */
export async function nodeGeoFor(
  nodeId: string,
  opts: { pinMissing: boolean; sites?: GeoUseSite[] },
): Promise<(NodeGeoIntended & { files: IntendedFile[] }) | null> {
  const sites = opts.sites ?? (await collectGeoUses());
  const names = [...new Set(sites.filter((s) => s.nodeIds.includes(nodeId)).map((s) => s.ref.set))];
  if (names.length === 0) return null;
  // Behind a direction of an enabled cascade: its chain reads its node policy.
  const cascadeExit =
    (await prisma.cascadeDirectionNode.count({
      where: { nodeId, direction: { cascade: { enabled: true } } },
    })) > 0;
  const chainTags = chainTagsFor(nodeId, sites, cascadeExit);

  const sets = await prisma.geoSet.findMany({
    where: { name: { in: names } },
    select: {
      id: true,
      name: true,
      kind: true,
      sourceType: true,
      current: { select: { id: true, version: true, sha256: true, sizeBytes: true } },
      pins: {
        where: { nodeId },
        select: { version: { select: { id: true, version: true, sha256: true, sizeBytes: true } } },
      },
    },
  });

  const files: IntendedFile[] = [];
  for (const set of sets) {
    let v = set.pins[0]?.version ?? null;
    if (!v && set.current) {
      v = set.current;
      if (opts.pinMissing) {
        await prisma.nodeGeoPin.upsert({
          where: { nodeId_geoSetId: { nodeId, geoSetId: set.id } },
          create: { nodeId, geoSetId: set.id, versionId: v.id },
          update: {},
        });
      }
    }
    if (!v) continue;
    files.push(...(await filesOfSet(set, v, chainTags.get(set.name) ?? [])));
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { version: geoVersionOf(files), files };
}

/**
 * Lays the node's geo files out on its agent and returns the `geo` block for
 * the push, or undefined for an agent older than geo (404 on /assets), which
 * then gets its push exactly as before.
 *
 * Only what differs by sha is sent. A node whose rules name no set at all
 * still gets an empty `geo` when its agent knows the field: that is what
 * clears the lists it no longer needs.
 */
export async function layOutGeo(transport: NodeTransport, nodeId: string): Promise<NodeGeo | undefined> {
  let onNode: Map<string, string>;
  try {
    const { files } = await transport.listAssets();
    onNode = new Map(files.map((f) => [f.name, f.sha256]));
  } catch (err) {
    if (err instanceof NodeRequestError && err.status === 404) return undefined;
    throw err;
  }

  const intended = await nodeGeoFor(nodeId, { pinMissing: true });
  const files: NodeGeoFile[] = [];
  for (const f of intended?.files ?? []) {
    if (onNode.get(f.name) !== f.sha256) {
      const bytes =
        f.reader === 'chain'
          ? (await chainRuleSet(f.versionSha, f.chainTag!, f.chainKind))!.bytes
          : (await prisma.geoBlob.findUniqueOrThrow({ where: { sha256: f.sha256 }, select: { data: true } })).data;
      await transport.putAsset(f.name, bytes, f.sha256);
    }
    files.push({ name: f.name, sha256: f.sha256, size: f.size, reader: f.reader });
  }
  return { version: geoVersionOf(files), files };
}

/** The node DTO's `geoIntended`: the files, without the panel's working
 *  fields. */
export function publicIntended(i: { version: string; files: IntendedFile[] } | null): NodeGeoIntended | null {
  if (!i) return null;
  return {
    version: i.version,
    files: i.files.map(({ name, sha256, reader, setId, setName, setVersion }) => ({
      name,
      sha256,
      reader,
      setId,
      setName,
      setVersion,
    })),
  };
}