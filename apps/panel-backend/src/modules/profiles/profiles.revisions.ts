import type { Prisma, Profile, ProfileRevision } from '../../generated/prisma/client.js';
import { sameValue } from '../../lib/util/same-value.js';
import { prisma } from '../../prisma.js';

export type RevisionActor = { type: 'admin' | 'apiToken'; name: string };
export type RevisionSource = 'form' | 'console' | 'recipe' | 'import';

export type RevisionMetadata = {
  actor?: RevisionActor;
  source?: RevisionSource;
};

export class ProfileRevisionError extends Error {
  constructor(
    public readonly code: 'PROFILE_REVISION_NOT_FOUND' | 'PROFILE_REVISION_CONFLICT' | 'PROFILE_REVISION_PROTECTED' | 'PROFILE_REVISION_INCOMPATIBLE',
    public readonly currentRevision?: number,
  ) {
    super(code);
  }
}

// Only these operator settings go into history. Keep managed key pairs together,
// and treat unrecognised/legacy fields as protected until explicitly reviewed.
const operatorFields: Readonly<Record<string, readonly string[]>> = {
  xray: [
    'security', 'tlsServerName', 'tlsRejectUnknownSni', 'realityDest', 'realityServerNames',
    'realityXver', 'realityMaxTimeDiff', 'realityLimitFallbackUploadBytesPerSec',
    'realityLimitFallbackDownloadBytesPerSec', 'realityMode', 'realityFallbackUpstream',
    'flow', 'fingerprint', 'network', 'path', 'host', 'serviceName', 'xhttpMode',
    'xhttpPaddingBytes', 'grpcMultiMode', 'tcpUserTimeout', 'tcpKeepAliveIdle',
    'tcpKeepAliveInterval', 'subprotocol',
  ],
  hysteria: ['hostname', 'masqueradeUrl', 'brutalUpMbps', 'brutalDownMbps', 'portHoppingStart', 'portHoppingEnd'],
  amneziawg: ['subnet', 'obfuscation'],
  naive: ['hostname', 'tlsEmail', 'masqueradeRoot'],
  shadowsocks: ['method'],
  // The FakeTLS domain and a binding ID together reproduce the credential.
  mtproto: [],
  mieru: ['mtu'],
  tuic: ['serverName', 'congestionControl'],
  anytls: ['serverName'],
  shadowtls: ['handshake', 'ssMethod'],
};
const obfuscationFields = new Set([
  'jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5',
]);

type ObjectValue = Prisma.JsonObject;
type Value = Prisma.JsonValue;
function isObject(value: Value | undefined): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isOperatorValue(key: string, value: Value): boolean {
  if (key === 'obfuscation') {
    return isObject(value) && Object.entries(value).every(([field, v]) =>
      obfuscationFields.has(field) && (typeof v === 'number' || typeof v === 'string'));
  }
  if (Array.isArray(value)) {
    return key === 'realityServerNames' && value.every((name) => typeof name === 'string');
  }
  if (typeof value === 'string' && ['masqueradeUrl', 'realityFallbackUpstream'].includes(key)) {
    try {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    } catch {
      // Some fields also take a plain domain or host:port.
      return !/[@?#]/.test(value);
    }
  }
  return !isObject(value);
}

export function splitProfileConfig(protocol: string, config: Value) {
  if (!isObject(config)) return { operator: {} as ObjectValue, protectedConfig: config, restorable: false } as const;
  const restorable = Object.hasOwn(operatorFields, protocol);
  const fields = restorable ? operatorFields[protocol]! : [];
  const entries = Object.entries(config).filter((entry): entry is [string, Value] => entry[1] !== undefined);
  const visible = ([key, value]: [string, Value]) => fields.includes(key) && isOperatorValue(key, value);
  return {
    operator: Object.fromEntries(entries.filter(visible)),
    protectedConfig: Object.fromEntries(entries.filter((entry) => !visible(entry))),
    restorable,
  } as const;
}

export function profileDocument(profile: Pick<Profile, 'protocol' | 'name' | 'description' | 'engine' | 'awgProtocol' | 'enabled' | 'config'>) {
  return {
    name: profile.name,
    description: profile.description,
    engine: profile.engine,
    awgProtocol: profile.awgProtocol,
    enabled: profile.enabled,
    config: splitProfileConfig(profile.protocol, profile.config).operator,
  };
}

export function baselineRevision(profile: Profile) {
  return {
    profileId: profile.id, revision: 1, createdAt: profile.updatedAt, kind: 'baseline',
    actorType: null, actorName: null, source: null, restoredFrom: null,
    document: profileDocument(profile), protectedVersion: 1,
  } satisfies ProfileRevision;
}

export function writeProfileRevision(
  tx: Prisma.TransactionClient,
  profile: Profile,
  revision: number,
  kind: 'created' | 'updated' | 'restored',
  metadata: RevisionMetadata,
  protectedVersion: number,
  restoredFrom?: number,
) {
  return tx.profileRevision.create({
    data: {
      profileId: profile.id, revision, kind, createdAt: profile.updatedAt, document: profileDocument(profile), protectedVersion,
      actorType: metadata.actor?.type, actorName: metadata.actor?.name,
      source: metadata.source, restoredFrom,
    },
  });
}

export function latestProfileRevision(tx: Prisma.TransactionClient, profileId: string) {
  return tx.profileRevision.findFirst({ where: { profileId }, orderBy: { revision: 'desc' } });
}

function revisionSummary(row: ProfileRevision) {
  return {
    revision: row.revision, createdAt: row.createdAt.toISOString(), kind: row.kind,
    restoredFrom: row.restoredFrom, source: row.source,
    actor: row.actorType && row.actorName ? { type: row.actorType, name: row.actorName } : null,
  };
}

const PAGE_SIZE = 30;
export function listProfileRevisions(profileId: string, before?: number) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new ProfileRevisionError('PROFILE_REVISION_NOT_FOUND');

    const head = await latestProfileRevision(tx, profileId);
    const rows = head ? await tx.profileRevision.findMany({
      where: { profileId, revision: before === undefined ? undefined : { lt: before } },
      orderBy: { revision: 'desc' },
      take: PAGE_SIZE + 1,
    }) : before === undefined || before > 1 ? [baselineRevision(profile)] : [];

    return {
      currentRevision: head?.revision ?? 1,
      revisions: rows.slice(0, PAGE_SIZE).map(revisionSummary),
      nextBefore: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1]!.revision : null,
    };
  }, { isolationLevel: 'RepeatableRead' });
}

type Change = { path: string[]; before: Value; after: Value; kind: 'added' | 'removed' | 'changed' };
function diff(before: Value | undefined, after: Value | undefined, path: string[], changes: Change[]): void {
  if (before !== undefined && after !== undefined) {
    if (sameValue(before, after)) return;
    if (isObject(before) && isObject(after)) {
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      for (const field of fields) diff(before[field], after[field], [...path, field], changes);
      return;
    }
  }
  changes.push({
    path, before: before ?? null, after: after ?? null,
    kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
  });
}

export async function findProfileRevision(
  tx: Prisma.TransactionClient,
  current: ProfileRevision,
  revision: number,
): Promise<ProfileRevision> {
  if (revision === current.revision) return current;
  const row = await tx.profileRevision.findUnique({
    where: { profileId_revision: { profileId: current.profileId, revision } },
  });
  if (!row) throw new ProfileRevisionError('PROFILE_REVISION_NOT_FOUND');
  return row;
}

export function diffProfileRevision(profileId: string, revision: number) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new ProfileRevisionError('PROFILE_REVISION_NOT_FOUND');
    const current = await latestProfileRevision(tx, profileId) ?? baselineRevision(profile);
    const target = await findProfileRevision(tx, current, revision);
    const changes: Change[] = [];
    diff(current.document, target.document, [], changes);
    return {
      currentRevision: current.revision, targetRevision: target.revision, changes,
      protectedConfigChanged: current.protectedVersion !== target.protectedVersion,
    };
  }, { isolationLevel: 'RepeatableRead' });
}
