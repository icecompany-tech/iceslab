import {
  GEO_BUILTIN_NAMES,
  GEO_SET_NAME,
  type GeoRolloutPlan,
  type GeoSetDto,
  type GeoSetKind,
  type GeoSetSource,
  type GeoSetTag,
  type GeoSetUse,
  type NodeGeoFact,
} from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { reportedEngines } from '../nodes/node-engines.js';
import { collectGeoUses, usesOf, type GeoUseSite } from './geo-refs.js';
import { chainTagsFor, filesOfSet } from './geo-push.js';
import { enqueueBuiltinFetch, enqueueUrlFetch } from './geo-sets.queue.js';
import { builtinNeedsFetch, ensureBuiltinSets } from './geo-sets.store.js';

/**
 * /api/geo-sets behind the routes. Contract: docs/plan/geo-contract.md
 * sections 5 to 7. The push that carries a rollout to the nodes is phase 9.2;
 * until then a rollout moves the pins and nothing else.
 */

// ---------------------------------------------------------------- refusals

export type GeoInvalidReason =
  | 'name'
  | 'name-reserved'
  | 'url'
  | 'sha256'
  | 'kind'
  | 'too-large'
  | 'source-not-editable';

export class GeoSetInvalidError extends Error {
  constructor(
    public readonly reason: GeoInvalidReason,
    message: string,
  ) {
    super(message);
  }
}
export class GeoSetNotFoundError extends Error {
  constructor(id: string) {
    super(`geo set ${id} not found`);
  }
}
export class GeoSetNameTakenError extends Error {
  constructor(name: string) {
    super(`a geo set named "${name}" already exists`);
  }
}
export class GeoSetInUseError extends Error {
  constructor(
    public readonly uses: GeoSetUse[],
    what: string,
  ) {
    super(`${what}: rules still name this set (${uses.map((u) => `${u.kind} "${u.name}"`).join(', ')})`);
  }
}
export class GeoSetBuiltinError extends Error {
  constructor(name: string) {
    super(`"${name}" is a built-in set and cannot be deleted`);
  }
}
export class GeoSetNotVerifiedError extends Error {
  constructor(name: string) {
    super(`"${name}" has no verified version yet`);
  }
}
export class GeoRolloutStaleError extends Error {
  constructor(
    public readonly current: string,
    asked: string,
  ) {
    super(`the plan was for version ${asked}, the set is now at ${current}: read the plan again`);
  }
}
export class GeoRolloutBreaksError extends Error {
  constructor(public readonly breaks: GeoRolloutPlan['breaks']) {
    super(`the new version lacks tags that rules name: ${breaks.map((b) => b.entry).join(', ')}`);
  }
}

// ---------------------------------------------------------------- reading

const SET_SELECT = {
  id: true,
  name: true,
  kind: true,
  sourceType: true,
  sourceTag: true,
  url: true,
  sha256Source: true,
  refreshHours: true,
  filename: true,
  format: true,
  status: true,
  checkedAt: true,
  error: true,
  currentVersionId: true,
  createdAt: true,
  updatedAt: true,
  current: { select: { id: true, version: true, sha256: true, sizeBytes: true, fetchedAt: true, tags: true } },
} as const;

type SetRow = NonNullable<Awaited<ReturnType<typeof findSet>>>;

function findSet(id: string) {
  return prisma.geoSet.findUnique({ where: { id }, select: SET_SELECT });
}

async function mustFind(id: string): Promise<SetRow> {
  const s = await findSet(id);
  if (!s) throw new GeoSetNotFoundError(id);
  return s;
}

function sourceOf(s: SetRow): GeoSetSource {
  switch (s.sourceType) {
    case 'builtin':
      return { type: 'builtin', tag: s.sourceTag ?? '' };
    case 'url':
      return {
        type: 'url',
        url: s.url ?? '',
        sha256Source: s.sha256Source === 'manual' ? 'manual' : 'sidecar',
        refreshHours: s.refreshHours ?? 24,
      };
    default:
      return { type: 'upload', filename: s.filename ?? '' };
  }
}

const tagsOf = (s: SetRow): GeoSetTag[] => (s.current?.tags as GeoSetTag[] | undefined) ?? [];

/** Nodes whose rules name the set, where each is pinned, and what each said
 *  lies on its disk. */
async function nodesOf(s: SetRow, sites: GeoUseSite[]) {
  const ids = [...new Set(sites.filter((x) => x.ref.set === s.name).flatMap((x) => x.nodeIds))];
  const [pins, rows] = await Promise.all([
    prisma.nodeGeoPin.findMany({
      where: { geoSetId: s.id, nodeId: { in: ids } },
      select: { nodeId: true, versionId: true, version: { select: { version: true, sha256: true, sizeBytes: true } } },
    }),
    prisma.node.findMany({ where: { id: { in: ids } }, select: { id: true, geo: true } }),
  ]);
  const pin = new Map(pins.map((p) => [p.nodeId, p]));
  const fact = new Map(rows.map((r) => [r.id, (r.geo as NodeGeoFact | null) ?? null]));
  return ids.map((id) => ({ id, pin: pin.get(id) ?? null, fact: fact.get(id) ?? null }));
}

/** The files of this set a node is to hold at version `v`: the `.dat`, and
 *  the chain's rule-sets when the node is a cascade entry whose route
 *  policies name tags of the set. */
function wantedOn(s: SetRow, v: { version: string; sha256: string; sizeBytes: number }, nodeId: string, sites: GeoUseSite[]) {
  return filesOfSet(s, v, chainTagsFor(nodeId, sites).get(s.name) ?? []);
}

/** The names of `wanted` the node's own report does not show with that sha;
 *  everything when it has not reported. */
function missingOnDisk(wanted: { name: string; sha256: string }[], fact: NodeGeoFact | null): string[] {
  const onDisk = new Map((fact?.files ?? []).map((f) => [f.name, f.sha256]));
  return wanted.filter((f) => fact === null || onDisk.get(f.name) !== f.sha256).map((f) => f.name);
}

async function toDto(s: SetRow, sites: GeoUseSite[]): Promise<GeoSetDto> {
  const nodes = await nodesOf(s, sites);
  /**
   * Behind by FACT, the same rule as the node card (ARCH 24.09): what the
   * node should hold of this set (its pin, or current where it has none yet,
   * which is what nodeGeoFor lays out) against what it reported, by sha. A
   * node that has not reported is not counted: the card calls it "did not
   * report", not "behind", and the two lists must say the same thing.
   */
  let behind = 0;
  for (const n of nodes) {
    const v = n.pin?.version ?? s.current;
    if (!v || n.fact === null) continue;
    if (missingOnDisk(await wantedOn(s, v, n.id, sites), n.fact).length > 0) behind++;
  }
  return {
    id: s.id,
    name: s.name,
    kind: s.kind as GeoSetKind,
    source: sourceOf(s),
    format: s.format as GeoSetDto['format'],
    status: s.status as GeoSetDto['status'],
    checkedAt: s.checkedAt?.toISOString() ?? null,
    error: s.error,
    current: s.current
      ? {
          version: s.current.version,
          sha256: s.current.sha256,
          sizeBytes: s.current.sizeBytes,
          fetchedAt: s.current.fetchedAt.toISOString(),
          tagCount: tagsOf(s).length,
        }
      : null,
    usedByRules: sites.filter((x) => x.ref.set === s.name).length,
    nodes: { total: nodes.length, behind },
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listGeoSets(): Promise<GeoSetDto[]> {
  await ensureBuiltinSets();
  const [rows, sites] = await Promise.all([
    prisma.geoSet.findMany({ select: SET_SELECT, orderBy: [{ sourceType: 'asc' }, { name: 'asc' }] }),
    collectGeoUses(),
  ]);
  return Promise.all(rows.map((r) => toDto(r, sites)));
}

export async function getGeoSet(id: string): Promise<GeoSetDto> {
  return toDto(await mustFind(id), await collectGeoUses());
}

export async function listTags(
  id: string,
  q: string,
  limit: number,
): Promise<{ version: string; total: number; tags: GeoSetTag[] }> {
  const s = await mustFind(id);
  if (!s.current) throw new GeoSetNotVerifiedError(s.name);
  const needle = q.trim().toLowerCase();
  const all = tagsOf(s)
    .filter((t) => t.name.includes(needle))
    // A tag that starts with what was typed before one that merely contains it.
    .sort((a, b) => Number(!a.name.startsWith(needle)) - Number(!b.name.startsWith(needle)) || a.name.localeCompare(b.name));
  return { version: s.current.version, total: all.length, tags: all.slice(0, limit) };
}

// ---------------------------------------------------------------- writing

function checkName(name: string): void {
  if (!GEO_SET_NAME.test(name)) {
    throw new GeoSetInvalidError('name', 'a name is 1 to 32 of a-z, 0-9 and "-": it becomes ext:<name>:<tag> and a file name on the node');
  }
  if (name === GEO_BUILTIN_NAMES.geosite || name === GEO_BUILTIN_NAMES.geoip) {
    throw new GeoSetInvalidError('name-reserved', `"${name}" is the built-in set's name: geosite:<tag> and geoip:<tag> already mean it`);
  }
}

function checkUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new GeoSetInvalidError('url', `"${url}" is not a URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new GeoSetInvalidError('url', `only http and https are fetched, not ${u.protocol}`);
  }
}

function checkSha(sha256Source: 'sidecar' | 'manual', sha256: string | undefined): string | null {
  if (sha256Source === 'sidecar') return null;
  if (!sha256 || !/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new GeoSetInvalidError('sha256', 'sha256 is set to manual: give the file\'s sha256, 64 hex characters');
  }
  return sha256.toLowerCase();
}

async function nameFree(name: string, exceptId?: string): Promise<void> {
  const other = await prisma.geoSet.findUnique({ where: { name }, select: { id: true } });
  if (other && other.id !== exceptId) throw new GeoSetNameTakenError(name);
}

export interface CreateUrlSetInput {
  name: string;
  kind: GeoSetKind;
  source: { type: 'url'; url: string; sha256Source: 'sidecar' | 'manual'; sha256?: string; refreshHours?: number };
}

/** A set fetched from the operator's URL. Answers `checking` at once; the
 *  download and the check run in the background. */
export async function createUrlSet(input: CreateUrlSetInput): Promise<GeoSetDto> {
  checkName(input.name);
  checkUrl(input.source.url);
  const manual = checkSha(input.source.sha256Source, input.source.sha256);
  await nameFree(input.name);
  const row = await prisma.geoSet.create({
    data: {
      name: input.name,
      kind: input.kind,
      sourceType: 'url',
      url: input.source.url,
      sha256Source: input.source.sha256Source,
      sha256Manual: manual,
      refreshHours: input.source.refreshHours ?? 24,
      status: 'checking',
    },
    select: { id: true },
  });
  await enqueueUrlFetch(row.id);
  return getGeoSet(row.id);
}

export interface PatchSetInput {
  name?: string;
  url?: string;
  sha256Source?: 'sidecar' | 'manual';
  sha256?: string;
  refreshHours?: number;
}

/**
 * Renaming breaks every `ext:<name>:` that spells the old name, so a set that
 * rules name is not renamed; the refusal says which rules. A new URL or sha
 * source takes effect at the next fetch, which this starts.
 */
export async function patchSet(id: string, input: PatchSetInput): Promise<GeoSetDto> {
  const s = await mustFind(id);
  const touchesSource = input.url !== undefined || input.sha256Source !== undefined || input.sha256 !== undefined || input.refreshHours !== undefined;
  if (s.sourceType === 'builtin') {
    throw new GeoSetInvalidError('source-not-editable', 'a built-in set follows the panel\'s pin and has nothing to edit');
  }
  if (touchesSource && s.sourceType !== 'url') {
    throw new GeoSetInvalidError('source-not-editable', 'only a set fetched from a URL has a URL and a sha256 source');
  }
  const data: {
    name?: string;
    url?: string;
    sha256Source?: string;
    sha256Manual?: string | null;
    refreshHours?: number;
  } = {};
  if (input.name !== undefined && input.name !== s.name) {
    checkName(input.name);
    await nameFree(input.name, id);
    const uses = usesOf(await collectGeoUses(), s.name);
    if (uses.length > 0) throw new GeoSetInUseError(uses, `"${s.name}" cannot be renamed`);
    data.name = input.name;
  }
  if (input.url !== undefined) {
    checkUrl(input.url);
    data.url = input.url;
  }
  if (input.sha256Source !== undefined || input.sha256 !== undefined) {
    const source = input.sha256Source ?? (s.sha256Source === 'manual' ? 'manual' : 'sidecar');
    data.sha256Source = source;
    data.sha256Manual = checkSha(source, input.sha256);
  }
  if (input.refreshHours !== undefined) data.refreshHours = input.refreshHours;
  await prisma.geoSet.update({ where: { id }, data });
  if (data.url !== undefined || data.sha256Source !== undefined) {
    await prisma.geoSet.update({ where: { id }, data: { status: 'checking' } });
    await enqueueUrlFetch(id);
  }
  return getGeoSet(id);
}

/** "Refresh now": fetch and check again. Never sends anything to a node. */
export async function refreshSet(id: string): Promise<GeoSetDto> {
  const s = await mustFind(id);
  if (s.sourceType === 'builtin') {
    const kind = s.kind as GeoSetKind;
    if (await builtinNeedsFetch(kind)) {
      await prisma.geoSet.update({ where: { id }, data: { status: 'checking' } });
      await enqueueBuiltinFetch(kind);
    }
  } else if (s.sourceType === 'url') {
    await prisma.geoSet.update({ where: { id }, data: { status: 'checking' } });
    await enqueueUrlFetch(id);
  } else {
    throw new GeoSetInvalidError('source-not-editable', 'an uploaded set is refreshed by uploading a new file');
  }
  return getGeoSet(id);
}

export async function deleteSet(id: string): Promise<void> {
  const s = await mustFind(id);
  if (s.sourceType === 'builtin') throw new GeoSetBuiltinError(s.name);
  const uses = usesOf(await collectGeoUses(), s.name);
  if (uses.length > 0) throw new GeoSetInUseError(uses, `"${s.name}" cannot be deleted`);
  await prisma.$transaction(async (tx) => {
    const shas = (await tx.geoSetVersion.findMany({ where: { geoSetId: id }, select: { sha256: true } })).map((v) => v.sha256);
    await tx.geoSet.delete({ where: { id } });
    // The bytes go with the set unless another set holds the same content.
    await tx.geoBlob.deleteMany({ where: { sha256: { in: shas }, versions: { none: {} } } });
  });
}

// ---------------------------------------------------------------- rollout

/**
 * What "send to the nodes" would do, before it is confirmed. Every node whose
 * rules name the set is listed.
 *
 * `filesToSend` is read off what the node SAID it holds (its healthcheck's
 * geo, file by file by sha256), not off its pin (ARCH 24.09, after a dev
 * frame: a pin moved, the node never reported, and the plan said "nothing to
 * send" about a machine nobody had looked at). The pin is the intent, the file
 * on disk the fact, and the plan speaks of the fact. A node that has not
 * reported gets the whole version. `from` stays the pin.
 *
 * `restartsXray` is true where a `.dat` is to be sent to a node that runs
 * xray, or that has not said what it runs: this is a warning in a
 * confirmation, and an unknown is shown as the worse case rather than hidden.
 */
export async function rolloutPlan(id: string): Promise<GeoRolloutPlan> {
  const s = await mustFind(id);
  if (!s.current) throw new GeoSetNotVerifiedError(s.name);
  const sites = await collectGeoUses();
  const nodes = await nodesOf(s, sites);
  const rows = await prisma.node.findMany({
    where: { id: { in: nodes.map((n) => n.id) } },
    select: { id: true, name: true, cores: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const current = s.current;

  const planNodes: GeoRolloutPlan['nodes'] = [];
  for (const n of nodes) {
    const row = byId.get(n.id);
    if (!row) continue;
    // What the node must hold of this set at current: the `.dat`, and at a
    // cascade entry the chain's rule-sets (phase 9.3).
    const filesToSend = missingOnDisk(await wantedOn(s, current, n.id, sites), n.fact);
    const engines = reportedEngines(row);
    planNodes.push({
      id: row.id,
      name: row.name,
      from: n.pin?.version.version ?? null,
      filesToSend,
      // A rule-set reaches the running chain without a restart; only a
      // `.dat` restarts xray.
      restartsXray: filesToSend.some((f) => f.endsWith('.dat')) && (engines === undefined || engines.includes('xray')),
    });
  }
  planNodes.sort((a, b) => a.name.localeCompare(b.name));

  const have = new Set(tagsOf(s).map((t) => t.name));
  const missing = new Map<string, GeoSetUse[]>();
  for (const site of sites) {
    if (site.ref.set !== s.name || have.has(site.ref.baseTag)) continue;
    const list = missing.get(site.ref.entry) ?? [];
    if (!list.some((u) => u.kind === site.owner.kind && u.id === site.owner.id)) list.push(site.owner);
    missing.set(site.ref.entry, list);
  }
  const breaks = [...missing].map(([entry, uses]) => ({ entry, uses })).sort((a, b) => a.entry.localeCompare(b.entry));
  return { version: s.current.version, nodes: planNodes, breaks };
}

/**
 * Moves every pin of the set to current and pushes the nodes the plan names:
 * those with a file to send, and those whose pin moved. `version` is the one
 * the operator confirmed; a set that moved since is refused, not guessed.
 * Answers how many nodes were pushed.
 */
export async function rollout(id: string, version: string): Promise<{ nodes: number }> {
  const s = await mustFind(id);
  if (!s.current || !s.currentVersionId) throw new GeoSetNotVerifiedError(s.name);
  if (s.current.version !== version) throw new GeoRolloutStaleError(s.current.version, version);
  const plan = await rolloutPlan(id);
  if (plan.breaks.length > 0) throw new GeoRolloutBreaksError(plan.breaks);
  const nodes = await nodesOf(s, await collectGeoUses());
  const moving = new Set(nodes.filter((n) => n.pin?.versionId !== s.currentVersionId).map((n) => n.id));
  const versionId = s.currentVersionId;
  await prisma.$transaction(
    [...moving].map((nodeId) =>
      prisma.nodeGeoPin.upsert({
        where: { nodeId_geoSetId: { nodeId, geoSetId: id } },
        create: { nodeId, geoSetId: id, versionId },
        update: { versionId },
      }),
    ),
  );
  // A push lays the files out and names them: every moved pin, and every
  // node that by its own report does not hold what its pin says.
  const pushed = plan.nodes.filter((n) => moving.has(n.id) || n.filesToSend.length > 0).map((n) => n.id);
  if (pushed.length > 0) eventBus.emit('geo.rolledOut', { geoSetId: id, nodeIds: pushed });
  return { nodes: pushed.length };
}
