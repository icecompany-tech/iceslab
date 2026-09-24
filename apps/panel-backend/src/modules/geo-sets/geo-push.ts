import { createHash } from 'node:crypto';
import type { NodeGeo, NodeGeoFile, NodeGeoIntended } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { NodeRequestError, type NodeTransport } from '../nodes/nodes.transport.js';
import { collectGeoUses, nodeFileName, type GeoUseSite } from './geo-refs.js';

/**
 * The `geo` of a push (phase 9.2, geo-contract.md sections 1, 2 and 7): which
 * files a node stands on, laid out on the agent before the push names them.
 *
 * Files follow the node's PINS, not the sets' current versions. A set a node
 * starts naming has no pin yet and is pinned to current on its first push:
 * no session there stands on it, so nothing is restarted behind anybody's
 * back. Everything after that moves only by a rollout.
 */

/** A label for a set of files: the first 12 hex of the sha256 of their
 *  sorted "name sha256" lines. Only a label; comparison is by file. */
export function geoVersionOf(files: { name: string; sha256: string }[]): string {
  const lines = files.map((f) => `${f.name} ${f.sha256}\n`).sort();
  return createHash('sha256').update(lines.join('')).digest('hex').slice(0, 12);
}

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
): Promise<NodeGeoIntended | null> {
  const sites = opts.sites ?? (await collectGeoUses());
  const names = [...new Set(sites.filter((s) => s.nodeIds.includes(nodeId)).map((s) => s.ref.set))];
  if (names.length === 0) return null;

  const sets = await prisma.geoSet.findMany({
    where: { name: { in: names } },
    select: {
      id: true,
      name: true,
      sourceType: true,
      currentVersionId: true,
      current: { select: { id: true, version: true, sha256: true } },
      pins: {
        where: { nodeId },
        select: { version: { select: { id: true, version: true, sha256: true } } },
      },
    },
  });

  const files: NodeGeoIntended['files'] = [];
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
    files.push({ name: nodeFileName(set), sha256: v.sha256, setId: set.id, setName: set.name, setVersion: v.version });
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
    const blob = await prisma.geoBlob.findUniqueOrThrow({
      where: { sha256: f.sha256 },
      select: { sizeBytes: true, ...(onNode.get(f.name) === f.sha256 ? {} : { data: true }) },
    });
    if ('data' in blob && blob.data) {
      await transport.putAsset(f.name, blob.data, f.sha256);
    }
    // Every file here is a `.dat` that xray reads. The chain's rule-sets join
    // with reader 'chain' when the chain starts reading them (phase 9.3).
    files.push({ name: f.name, sha256: f.sha256, size: blob.sizeBytes, reader: 'xray' });
  }
  return { version: geoVersionOf(files), files };
}
