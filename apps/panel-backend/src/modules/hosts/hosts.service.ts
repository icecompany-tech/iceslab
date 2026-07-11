import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import { mapHost, type PublicHostDto } from './hosts.mapper.js';
import type {
  CreateHostInput,
  ListHostsQuery,
  ReorderHostsInput,
  UpdateHostInput,
} from './hosts.schemas.js';

// ───── Errors ─────

export class HostNotFoundError extends Error {
  constructor(public id: string) {
    super(`Host ${id} not found`);
    this.name = 'HostNotFoundError';
  }
}

export class BindingNotFoundError extends Error {
  constructor(public id: string) {
    super(`Binding ${id} not found`);
    this.name = 'BindingNotFoundError';
  }
}

// ───── CRUD ─────

export async function listHosts(q: ListHostsQuery): Promise<PublicHostDto[]> {
  const where: Prisma.HostWhereInput = {};
  if (q.bindingId) where.bindingId = q.bindingId;
  // F7 - profileId/nodeId both filter through the binding relation; combine so
  // passing both narrows to a node's bindings of that profile.
  if (q.profileId || q.nodeId) {
    where.binding = {
      ...(q.profileId ? { profileId: q.profileId } : {}),
      ...(q.nodeId ? { nodeId: q.nodeId } : {}),
    };
  }
  const rows = await prisma.host.findMany({
    where,
    orderBy: [{ bindingId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(mapHost);
}

export async function getHostById(id: string): Promise<PublicHostDto> {
  const h = await prisma.host.findUnique({ where: { id } });
  if (!h) throw new HostNotFoundError(id);
  return mapHost(h);
}

export async function createHost(input: CreateHostInput): Promise<PublicHostDto> {
  const binding = await prisma.profileNodeBinding.findUnique({
    where: { id: input.bindingId },
  });
  if (!binding) throw new BindingNotFoundError(input.bindingId);

  const created = await prisma.host.create({
    data: {
      bindingId: input.bindingId,
      remark: input.remark,
      priority: input.priority,
      enabled: input.enabled,
      addressOverride: input.addressOverride ?? null,
      portOverride: input.portOverride ?? null,
      sniOverride: input.sniOverride ?? null,
      hostHeaderOverride: input.hostHeaderOverride ?? null,
      pathOverride: input.pathOverride ?? null,
      fingerprintOverride: input.fingerprintOverride ?? null,
      alpn: input.alpn,
      allowInsecure: input.allowInsecure,
      securityLayer: input.securityLayer,
      disableForFormats: input.disableForFormats,
    },
  });
  // Bust the subscription bindings cache (review M5) — a new host adds an
  // endpoint that would otherwise not appear until the 60s TTL lapses.
  eventBus.emit('host.changed', { hostId: created.id });
  return mapHost(created);
}

export async function updateHost(
  id: string,
  input: UpdateHostInput,
): Promise<PublicHostDto> {
  const existing = await prisma.host.findUnique({ where: { id } });
  if (!existing) throw new HostNotFoundError(id);

  const data: Prisma.HostUpdateInput = {};
  if (input.remark !== undefined) data.remark = input.remark;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.addressOverride !== undefined) data.addressOverride = input.addressOverride;
  if (input.portOverride !== undefined) data.portOverride = input.portOverride;
  if (input.sniOverride !== undefined) data.sniOverride = input.sniOverride;
  if (input.hostHeaderOverride !== undefined) {
    data.hostHeaderOverride = input.hostHeaderOverride;
  }
  if (input.pathOverride !== undefined) data.pathOverride = input.pathOverride;
  if (input.fingerprintOverride !== undefined) {
    data.fingerprintOverride = input.fingerprintOverride;
  }
  if (input.alpn !== undefined) data.alpn = input.alpn;
  if (input.allowInsecure !== undefined) data.allowInsecure = input.allowInsecure;
  if (input.securityLayer !== undefined) data.securityLayer = input.securityLayer;
  if (input.disableForFormats !== undefined) {
    data.disableForFormats = input.disableForFormats;
  }

  const updated = await prisma.host.update({ where: { id }, data });
  eventBus.emit('host.changed', { hostId: updated.id });
  return mapHost(updated);
}

export async function deleteHost(id: string): Promise<void> {
  const existing = await prisma.host.findUnique({ where: { id } });
  if (!existing) throw new HostNotFoundError(id);
  await prisma.host.delete({ where: { id } });
  eventBus.emit('host.changed', { hostId: id });
}

/**
 * Bulk-rewrite priority based on the order of the supplied host IDs. Hosts
 * outside the list are untouched. Used by the drag-and-drop UI which sends
 * the full ordered list of a binding's hosts in one request.
 */
export async function reorderHosts(input: ReorderHostsInput): Promise<PublicHostDto[]> {
  const found = await prisma.host.findMany({
    where: { id: { in: input.hostIds } },
    select: { id: true, bindingId: true },
  });
  if (found.length !== input.hostIds.length) {
    const seen = new Set(found.map((h) => h.id));
    const missing = input.hostIds.find((id) => !seen.has(id));
    throw new HostNotFoundError(missing ?? '?');
  }

  await prisma.$transaction(
    input.hostIds.map((id, i) =>
      prisma.host.update({ where: { id }, data: { priority: i } }),
    ),
  );

  // Return all touched hosts in the new order.
  const refreshed = await prisma.host.findMany({
    where: { id: { in: input.hostIds } },
  });
  const byId = new Map(refreshed.map((h) => [h.id, h]));
  // Reordering changes host priority → subscription URL order; bust (review M5).
  eventBus.emit('host.changed', {});
  return input.hostIds.map((id) => mapHost(byId.get(id)!));
}

/**
 * Auto-create the "Default" host for a freshly-minted binding. Called by
 * profiles.service.ts:createBinding so subscriptions still emit one URL per
 * binding by default. Idempotent, if a host already exists for this
 * binding (e.g. backfilled by migration) this is a no-op.
 */
export async function ensureDefaultHost(bindingId: string): Promise<void> {
  const has = await prisma.host.findFirst({
    where: { bindingId },
    select: { id: true },
  });
  if (has) return;
  await prisma.host.create({
    data: { bindingId, remark: 'Default', priority: 0, enabled: true },
  });
}
