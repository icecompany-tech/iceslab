import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import {
  PROTOCOL_CONFIG_SCHEMAS,
} from '../inbounds/inbounds.schemas.js';
import { ensureDefaultHost } from '../hosts/hosts.service.js';
import {
  generateSsServerPsk,
} from './ss-helpers.js';
import type {
  CreateBindingInput,
  CreateProfileInput,
  UpdateBindingInput,
  UpdateProfileInput,
  ListBindingsQuery,
  ListProfilesQuery,
} from './profiles.schemas.js';
import {
  mapBinding,
  mapProfile,
  type PublicBindingDto,
  type PublicProfileDto,
} from './profiles.mapper.js';

// ───── Errors ─────

export class ProfileNotFoundError extends Error {
  constructor(public id: string) {
    super(`Profile ${id} not found`);
    this.name = 'ProfileNotFoundError';
  }
}
export class BindingNotFoundError extends Error {
  constructor(public id: string) {
    super(`Binding ${id} not found`);
    this.name = 'BindingNotFoundError';
  }
}
export class ProfileNameTakenError extends Error {
  constructor(public name: string) {
    super(`Profile name "${name}" already in use`);
    this.name = 'ProfileNameTakenError';
  }
}
export class PortInUseError extends Error {
  constructor(public port: number, nodeName: string, conflictProfile: string) {
    super(
      `Port ${port} on node "${nodeName}" is already used by profile "${conflictProfile}". Pick a different port.`,
    );
    this.name = 'PortInUseError';
  }
}

// F-P1-b — candidate listen ports for a new binding, in preference order.
// Common HTTPS-alt ports that survive most ISP egress filters and read as
// ordinary TLS (good for REALITY / Hysteria masquerade). 443 first because it's
// the least suspicious; the rest are Cloudflare-proxy ports. Replaces the old
// blind "default to 443" that guaranteed a 409 when adding a second protocol to
// a node already listening on 443.
export const CANDIDATE_PORTS = [443, 8443, 2053, 2083, 2087, 2096] as const;

// pickFreePort returns the first CANDIDATE_PORTS entry not already taken on the
// node. If every candidate is in use it scans upward from 20000 for the first
// free port, so a node running many protocols still gets a usable suggestion
// instead of a guaranteed conflict. Pure (no DB) so it's unit-testable.
export function pickFreePort(used: Iterable<number>): number {
  const taken = new Set<number>(used);
  for (const p of CANDIDATE_PORTS) {
    if (!taken.has(p)) return p;
  }
  for (let p = 20000; p <= 65000; p++) {
    if (!taken.has(p)) return p;
  }
  // Pathological (45000 ports bound on one node): fall back to 443 and let the
  // createBinding conflict check surface a human 409.
  return 443;
}

// nextFreePortForNode suggests a listen port for a NEW binding on `nodeId`,
// avoiding every port already bound there. Powers the deploy modal's port
// pre-fill and the future in-node "+ Add protocol" flow.
export async function nextFreePortForNode(nodeId: string): Promise<number> {
  const bindings = await prisma.profileNodeBinding.findMany({
    where: { nodeId },
    select: { port: true },
  });
  return pickFreePort(bindings.map((b) => b.port));
}
export class NodeAlreadyBoundError extends Error {
  constructor(public profileId: string, public nodeId: string) {
    super(`Node ${nodeId} is already bound to profile ${profileId}`);
    this.name = 'NodeAlreadyBoundError';
  }
}
export class NodeNotFoundError extends Error {
  constructor(public id: string) {
    super(`Node ${id} not found`);
    this.name = 'NodeNotFoundError';
  }
}

// A5 — per-profile user reach: distinct users across every squad the profile is
// assigned to (group_profiles -> group_members), deduped. Users are explicit
// members of their squads (incl. the system "All" squad), so this also counts
// the "All" reach. One aggregate for the list; a scoped count for a single one.
async function userReachByProfile(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ profile_id: string; user_count: number }[]>`
    SELECT gp.profile_id, COUNT(DISTINCT gm.user_id)::int AS user_count
    FROM group_profiles gp
    JOIN group_members gm ON gm.group_id = gp.group_id
    GROUP BY gp.profile_id
  `;
  return new Map(rows.map((r) => [r.profile_id, r.user_count]));
}

async function userReachForProfile(profileId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ user_count: number }[]>`
    SELECT COUNT(DISTINCT gm.user_id)::int AS user_count
    FROM group_profiles gp
    JOIN group_members gm ON gm.group_id = gp.group_id
    WHERE gp.profile_id = ${profileId}::uuid
  `;
  return rows[0]?.user_count ?? 0;
}

// ───── Profile CRUD ─────

export async function createProfile(input: CreateProfileInput): Promise<PublicProfileDto> {
  const existing = await prisma.profile.findUnique({ where: { name: input.name } });
  if (existing) throw new ProfileNameTakenError(input.name);

  // Slice 24d — auto-fill SS2022 server PSK if admin omitted it.
  let configToStore: Record<string, unknown> = input.config as Record<string, unknown>;
  if (input.protocol === 'shadowsocks') {
    const ss = configToStore as { method: string; serverPsk?: string };
    if (!ss.serverPsk) {
      configToStore = { ...ss, serverPsk: generateSsServerPsk(ss.method) };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.profile.create({
      data: {
        name: input.name,
        protocol: input.protocol,
        description: input.description ?? null,
        config: configToStore as never,
        enabled: input.enabled,
      },
    });
    // Slice 26 invariant — every new profile auto-attaches to "All" squad.
    await tx.groupProfile.upsert({
      where: { groupId_profileId: { groupId: ALL_SQUAD_ID, profileId: p.id } },
      create: { groupId: ALL_SQUAD_ID, profileId: p.id },
      update: {},
    });
    return p;
  });

  eventBus.emit('profile.created', { profileId: created.id });
  return mapProfile({ ...created, _count: { bindings: 0 } });
}

export async function listProfiles(q: ListProfilesQuery): Promise<PublicProfileDto[]> {
  const profiles = await prisma.profile.findMany({
    where: q.protocol ? { protocol: q.protocol } : undefined,
    orderBy: [{ protocol: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { bindings: true } } },
  });
  const reach = await userReachByProfile();
  return profiles.map((p) => mapProfile(p, reach.get(p.id) ?? 0));
}

export async function getProfileById(id: string): Promise<PublicProfileDto> {
  const profile = await prisma.profile.findUnique({
    where: { id },
    include: { _count: { select: { bindings: true } } },
  });
  if (!profile) throw new ProfileNotFoundError(id);
  return mapProfile(profile, await userReachForProfile(id));
}

export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<PublicProfileDto> {
  const existing = await prisma.profile.findUnique({ where: { id } });
  if (!existing) throw new ProfileNotFoundError(id);

  if (input.name && input.name !== existing.name) {
    const collision = await prisma.profile.findUnique({ where: { name: input.name } });
    if (collision) throw new ProfileNameTakenError(input.name);
  }

  const data: Prisma.ProfileUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.enabled !== undefined) data.enabled = input.enabled;

  if (input.config !== undefined) {
    const schema = PROTOCOL_CONFIG_SCHEMAS[
      existing.protocol as keyof typeof PROTOCOL_CONFIG_SCHEMAS
    ];
    if (!schema) throw new Error(`Unknown protocol ${existing.protocol}`);
    const parsed = schema.parse(input.config);
    data.config = parsed as never;
  }

  const updated = await prisma.profile.update({
    where: { id },
    data,
    include: { _count: { select: { bindings: true } } },
  });
  eventBus.emit('profile.updated', { profileId: id });
  return mapProfile(updated, await userReachForProfile(id));
}

export async function deleteProfile(id: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { id },
    include: { bindings: { select: { nodeId: true } } },
  });
  if (!profile) throw new ProfileNotFoundError(id);

  const affectedNodeIds = profile.bindings.map((b) => b.nodeId);
  await prisma.profile.delete({ where: { id } });

  eventBus.emit('profile.deleted', { profileId: id, affectedNodeIds });
}

// ───── Bindings CRUD ─────

export async function createBinding(input: CreateBindingInput): Promise<PublicBindingDto> {
  const profile = await prisma.profile.findUnique({ where: { id: input.profileId } });
  if (!profile) throw new ProfileNotFoundError(input.profileId);
  const node = await prisma.node.findFirst({
    where: { id: input.nodeId, deletedAt: null },
  });
  if (!node) throw new NodeNotFoundError(input.nodeId);

  // Pre-flight uniqueness checks for friendlier error messages.
  const portConflict = await prisma.profileNodeBinding.findUnique({
    where: { nodeId_port: { nodeId: input.nodeId, port: input.port } },
    include: { profile: { select: { name: true } } },
  });
  if (portConflict) throw new PortInUseError(input.port, node.name, portConflict.profile.name);
  const dupBinding = await prisma.profileNodeBinding.findUnique({
    where: {
      profileId_nodeId: { profileId: input.profileId, nodeId: input.nodeId },
    },
  });
  if (dupBinding) throw new NodeAlreadyBoundError(input.profileId, input.nodeId);

  const created = await prisma.profileNodeBinding.create({
    data: {
      profileId: input.profileId,
      nodeId: input.nodeId,
      port: input.port,
      publicHost: input.publicHost ?? null,
      publicPort: input.publicPort ?? null,
      overrides: (input.overrides as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      enabled: input.enabled,
    },
  });
  // Slice 30 — every new binding ships with one Default host so the
  // subscription generator (which iterates bindings × hosts) has something
  // to emit. Admin can later add extras with different SNI / fingerprint.
  await ensureDefaultHost(created.id);
  eventBus.emit('binding.created', {
    bindingId: created.id,
    profileId: created.profileId,
    nodeId: created.nodeId,
  });
  return mapBinding(created);
}

export async function listBindings(q: ListBindingsQuery): Promise<PublicBindingDto[]> {
  // Skip bindings whose node was soft-deleted — otherwise DeployProfileModal
  // / profile cards would carry phantom rows from removed nodes.
  const where: Prisma.ProfileNodeBindingWhereInput = { node: { deletedAt: null } };
  if (q.nodeId) where.nodeId = q.nodeId;
  if (q.profileId) where.profileId = q.profileId;
  const rows = await prisma.profileNodeBinding.findMany({
    where,
    orderBy: [{ nodeId: 'asc' }, { port: 'asc' }],
  });
  return rows.map(mapBinding);
}

export async function getBindingById(id: string): Promise<PublicBindingDto> {
  const b = await prisma.profileNodeBinding.findUnique({ where: { id } });
  if (!b) throw new BindingNotFoundError(id);
  return mapBinding(b);
}

export async function updateBinding(
  id: string,
  input: UpdateBindingInput,
): Promise<PublicBindingDto> {
  const existing = await prisma.profileNodeBinding.findUnique({ where: { id } });
  if (!existing) throw new BindingNotFoundError(id);

  if (input.port !== undefined && input.port !== existing.port) {
    const portConflict = await prisma.profileNodeBinding.findUnique({
      where: { nodeId_port: { nodeId: existing.nodeId, port: input.port } },
      include: {
        profile: { select: { name: true } },
        node: { select: { name: true } },
      },
    });
    if (portConflict && portConflict.id !== id) {
      throw new PortInUseError(input.port, portConflict.node.name, portConflict.profile.name);
    }
  }

  const data: Prisma.ProfileNodeBindingUpdateInput = {};
  if (input.port !== undefined) data.port = input.port;
  if (input.publicHost !== undefined) data.publicHost = input.publicHost;
  if (input.publicPort !== undefined) data.publicPort = input.publicPort;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.overrides !== undefined) {
    data.overrides =
      input.overrides === null
        ? Prisma.JsonNull
        : (input.overrides as Prisma.InputJsonValue);
  }

  const updated = await prisma.profileNodeBinding.update({ where: { id }, data });
  eventBus.emit('binding.updated', {
    bindingId: id,
    profileId: updated.profileId,
    nodeId: updated.nodeId,
  });
  return mapBinding(updated);
}

export async function deleteBinding(id: string): Promise<void> {
  const existing = await prisma.profileNodeBinding.findUnique({ where: { id } });
  if (!existing) throw new BindingNotFoundError(id);
  await prisma.profileNodeBinding.delete({ where: { id } });
  eventBus.emit('binding.deleted', {
    bindingId: id,
    profileId: existing.profileId,
    nodeId: existing.nodeId,
  });
}

// ───── Resolution ─────

/**
 * Resolve the deployable inbound config for a (profile, node) pair: shallow
 * merge of `profile.config` + `binding.overrides`. Used by the inbound-sync
 * queue when shipping configs to node-agents and by the subscription
 * generator when emitting client URIs.
 *
 * Shallow merge is intentional — overrides should mention specific top-level
 * fields (`acmeDomain`, `serverPsk`, etc.). Deep merge would silently mask
 * partial-array edits which is rarely what admins mean.
 */
export function resolveBindingConfig(
  profileConfig: unknown,
  overrides: unknown,
): Record<string, unknown> {
  const base = (profileConfig ?? {}) as Record<string, unknown>;
  const ov = (overrides ?? {}) as Record<string, unknown>;
  return { ...base, ...ov };
}

