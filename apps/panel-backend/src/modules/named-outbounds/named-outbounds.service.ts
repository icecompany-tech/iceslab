import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { mapNamedOutbound, type NamedOutboundUse, type PublicNamedOutbound } from './named-outbounds.mapper.js';
import {
  CONFIG_SCHEMAS,
  DIRECTION_OUTBOUND_TYPES,
  type CreateNamedOutboundInput,
  type NamedOutboundType,
  type UpdateNamedOutboundInput,
} from './named-outbounds.schemas.js';

export class NamedOutboundNotFoundError extends Error {
  constructor(public id: string) {
    super(`Named outbound ${id} not found`);
    this.name = 'NamedOutboundNotFoundError';
  }
}

export class NamedOutboundNameTakenError extends Error {
  readonly code = 'NAMED_OUTBOUND_NAME_TAKEN';
  constructor(public outboundName: string) {
    super(`A named outbound "${outboundName}" already exists`);
    this.name = 'NamedOutboundNameTakenError';
  }
}

/** A DELETE of an outbound directions stand on. RESTRICT in the database
 *  backs it; this is the refusal that names them. */
export class NamedOutboundInUseError extends Error {
  readonly code = 'NAMED_OUTBOUND_IN_USE';
  constructor(public usedBy: NamedOutboundUse[]) {
    super(
      `The outbound is the way out of ${usedBy
        .map((u) => `direction ${u.directionTag} of cascade "${u.cascadeName}"`)
        .join(', ')}. Move those directions off it first.`,
    );
    this.name = 'NamedOutboundInUseError';
  }
}

/** A save that would turn an outbound directions stand on into a type a
 *  direction cannot take (freedom, blackhole). */
export class NamedOutboundTypeNotForDirectionError extends Error {
  readonly code = 'NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION';
  constructor(
    public type: NamedOutboundType,
    public usedBy: NamedOutboundUse[],
  ) {
    super(
      `A cascade direction goes out through ${DIRECTION_OUTBOUND_TYPES.join(' or ')}, not ${type}, and ` +
        `${usedBy.length} direction(s) stand on this outbound.`,
    );
    this.name = 'NamedOutboundTypeNotForDirectionError';
  }
}

/** The per-type config failed its schema on an update (the create path fails
 *  in the request schema). Carries the zod issues as a 400 would. */
export class NamedOutboundConfigInvalidError extends Error {
  constructor(public issues: { path: (string | number)[]; message: string }[]) {
    super(issues.map((i) => `${['config', ...i.path].join('.')}: ${i.message}`).join('; '));
    this.name = 'NamedOutboundConfigInvalidError';
  }
}

const withUse = {
  directions: { select: { tag: true, cascade: { select: { id: true, name: true } } } },
} as const;

export async function listNamedOutbounds(): Promise<PublicNamedOutbound[]> {
  const rows = await prisma.namedOutbound.findMany({ orderBy: { name: 'asc' }, include: withUse });
  return rows.map(mapNamedOutbound);
}

export async function getNamedOutbound(id: string): Promise<PublicNamedOutbound> {
  const row = await prisma.namedOutbound.findUnique({ where: { id }, include: withUse });
  if (!row) throw new NamedOutboundNotFoundError(id);
  return mapNamedOutbound(row);
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const other = await prisma.namedOutbound.findUnique({ where: { name }, select: { id: true } });
  if (other && other.id !== exceptId) throw new NamedOutboundNameTakenError(name);
}

export async function createNamedOutbound(input: CreateNamedOutboundInput): Promise<PublicNamedOutbound> {
  await assertNameFree(input.name);
  const row = await prisma.namedOutbound.create({
    data: {
      name: input.name,
      type: input.type,
      countryCode: input.countryCode ?? null,
      config: input.config as Prisma.InputJsonValue,
    },
    include: withUse,
  });
  return mapNamedOutbound(row);
}

export async function updateNamedOutbound(id: string, input: UpdateNamedOutboundInput): Promise<PublicNamedOutbound> {
  const existing = await prisma.namedOutbound.findUnique({ where: { id }, include: withUse });
  if (!existing) throw new NamedOutboundNotFoundError(id);
  if (input.name !== undefined && input.name !== existing.name) await assertNameFree(input.name, id);

  const data: Prisma.NamedOutboundUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if ('countryCode' in input && input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.config !== undefined) {
    const type = (input.type ?? existing.type) as NamedOutboundType;
    // A type change is allowed (ARCH 26.09, the chain redraws on the next
    // push), except onto a type no direction may stand on while some do.
    const used = mapNamedOutbound(existing).usedBy;
    if (used.length > 0 && !DIRECTION_OUTBOUND_TYPES.includes(type)) {
      throw new NamedOutboundTypeNotForDirectionError(type, used);
    }
    const parsed = CONFIG_SCHEMAS[type].safeParse(input.config);
    if (!parsed.success) {
      throw new NamedOutboundConfigInvalidError(
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    data.type = type;
    data.config = parsed.data as Prisma.InputJsonValue;
  }

  const row = await prisma.namedOutbound.update({ where: { id }, data, include: withUse });
  // The chains that draw it redraw: the nodes of the cascades it stands in are
  // re-pushed, the way any cascade edit re-pushes them.
  const cascadeIds = [...new Set(row.directions.map((d) => d.cascade.id))];
  if (cascadeIds.length > 0) {
    const nodes = await prisma.cascadePositionNode.findMany({
      where: { position: { cascadeId: { in: cascadeIds } } },
      select: { nodeId: true },
    });
    const nodeIds = [...new Set(nodes.map((n) => n.nodeId))];
    if (nodeIds.length > 0) eventBus.emit('cascade.changed', { nodeIds });
  }
  return mapNamedOutbound(row);
}

export async function deleteNamedOutbound(id: string): Promise<void> {
  const existing = await prisma.namedOutbound.findUnique({ where: { id }, include: withUse });
  if (!existing) throw new NamedOutboundNotFoundError(id);
  const used = mapNamedOutbound(existing).usedBy;
  if (used.length > 0) throw new NamedOutboundInUseError(used);
  await prisma.namedOutbound.delete({ where: { id } });
}
