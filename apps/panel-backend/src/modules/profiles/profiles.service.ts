import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import {
  PROTOCOL_CONFIG_SCHEMAS,
} from '../inbounds/inbounds.schemas.js';
import { ensureDefaultHost } from '../hosts/hosts.service.js';
import {
  generateSsServerPsk,
} from './ss-helpers.js';
import { engineValidForProtocol } from './profiles.schemas.js';
import {
  effectiveEngineOf,
  nodeRendersProfile,
  renderableAtSave,
} from '../nodes/node-engines.js';
import { stripInapplicableTransportFields } from '../inbounds/xray-transport-fields.js';
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

// F-P1-b: candidate listen ports for a new binding, in preference order.
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

// A5 - per-profile user reach: distinct users across every squad the profile is
// assigned to (group_profiles -> group_members), deduped. Users are explicit
// members of their squads (incl. the system "All" squad), so this also counts
// the "All" reach. One aggregate for the list; a scoped count for a single one.
//
// Soft-deleted users keep their group_members rows (we only flip
// users.deletedAt, the join row stays for restore-ability, same reason the
// squad member count joins users). Without the users join below, a profile on
// the "All" squad reports every ghost ever created, not the live reach.
async function userReachByProfile(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ profile_id: string; user_count: number }[]>`
    SELECT gp.profile_id, COUNT(DISTINCT gm.user_id)::int AS user_count
    FROM group_profiles gp
    JOIN group_members gm ON gm.group_id = gp.group_id
    JOIN users u ON u.id = gm.user_id AND u.deleted_at IS NULL
    GROUP BY gp.profile_id
  `;
  return new Map(rows.map((r) => [r.profile_id, r.user_count]));
}

async function userReachForProfile(profileId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ user_count: number }[]>`
    SELECT COUNT(DISTINCT gm.user_id)::int AS user_count
    FROM group_profiles gp
    JOIN group_members gm ON gm.group_id = gp.group_id
    JOIN users u ON u.id = gm.user_id AND u.deleted_at IS NULL
    WHERE gp.profile_id = ${profileId}::uuid
  `;
  return rows[0]?.user_count ?? 0;
}

// ───── Profile CRUD ─────

export async function createProfile(input: CreateProfileInput): Promise<PublicProfileDto> {
  const existing = await prisma.profile.findUnique({ where: { name: input.name } });
  if (existing) throw new ProfileNameTakenError(input.name);

  // Slice 24d: auto-fill SS2022 server PSK if admin omitted it.
  let configToStore: Record<string, unknown> = input.config as Record<string, unknown>;
  if (input.protocol === 'shadowsocks') {
    const ss = configToStore as { method: string; serverPsk?: string };
    if (!ss.serverPsk) {
      configToStore = { ...ss, serverPsk: generateSsServerPsk(ss.method) };
    }
  }
  /**
   * ShadowTLS: fill in the inner shadowsocks server key the same way.
   *
   * It is optional in the schema because the operator is not meant to invent
   * it, and the node refuses an inbound without one ("shadowtls ssPassword
   * (inner shadowsocks key) is required"). The autofill existed only on the
   * per-node inbound path, which is not how anything deploys any more: it goes
   * through Profile -> ProfileNodeBinding. So a ShadowTLS profile created
   * through the API arrived at the node with no key and was rejected there,
   * one layer away from the operator who could act on it (A-029).
   */
  if (input.protocol === 'shadowtls') {
    const st = configToStore as { ssMethod: string; ssPassword?: string };
    if (!st.ssPassword) {
      configToStore = { ...st, ssPassword: generateSsServerPsk(st.ssMethod) };
    }
  }
  // Keep only the transport settings this profile's transport uses, so a field
  // typed for a transport that was later switched away cannot come back to life
  // when the operator switches back. See stripInapplicableTransportFields.
  if (input.protocol === 'xray') {
    configToStore = stripInapplicableTransportFields(configToStore);
  }

  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.profile.create({
      data: {
        name: input.name,
        protocol: input.protocol,
        engine: input.engine ?? null,
        description: input.description ?? null,
        config: configToStore as never,
        enabled: input.enabled,
      },
    });
    // Slice 26 invariant: every new profile auto-attaches to "All" squad.
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
  if (input.engine !== undefined) {
    if (!engineValidForProtocol(existing.protocol, input.engine)) {
      throw new Error(
        `engine "${input.engine}" is not valid for protocol "${existing.protocol}"`,
      );
    }
    data.engine = input.engine;
    // Changing the engine changes the pair on EVERY node this profile is
    // deployed to, so it is the same save-time question as creating a binding,
    // asked once per node. Editing an inbound out from under its own nodes is
    // how a profile ends up deployed where nothing serves it.
    if (effectiveEngineOf({ protocol: existing.protocol, engine: input.engine ?? null }) !==
        effectiveEngineOf(existing)) {
      const deployed = await prisma.profileNodeBinding.findMany({
        where: { profileId: id, node: { deletedAt: null } },
        select: { node: { select: { name: true, cores: true } } },
      });
      for (const b of deployed) {
        assertNodeRendersProfile(b.node, { protocol: existing.protocol, engine: input.engine ?? null });
      }
    }
  }

  if (input.config !== undefined) {
    const schema = PROTOCOL_CONFIG_SCHEMAS[
      existing.protocol as keyof typeof PROTOCOL_CONFIG_SCHEMAS
    ];
    if (!schema) throw new Error(`Unknown protocol ${existing.protocol}`);
    const parsed = schema.parse(input.config);
    /**
     * ShadowTLS keeps its inner key across an edit.
     *
     * `ssPassword` is optional in the schema and no form field fills it, so a
     * save from the profile screen sends a config without it. A plain overwrite
     * would drop the key the node is running, and the next push would be
     * refused - an unrelated edit (renaming the camouflage domain) silently
     * breaking the inbound. Same shape as the squad-save incident of
     * 2026-07-31: never let a payload that cannot express a field erase it.
     */
    if (existing.protocol === 'shadowtls') {
      const incoming = parsed as { ssMethod: string; ssPassword?: string };
      if (!incoming.ssPassword) {
        const stored = (existing.config ?? {}) as { ssPassword?: string };
        incoming.ssPassword = stored.ssPassword ?? generateSsServerPsk(incoming.ssMethod);
      }
    }
    // After parse, so schema defaults are filled in first and only then the
    // fields belonging to other transports are dropped.
    data.config = (
      existing.protocol === 'xray'
        ? stripInapplicableTransportFields(parsed as Record<string, unknown>)
        : parsed
    ) as never;
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

/**
 * No core on this node renders this profile, so the inbound would never come up.
 *
 * Refused at the save, where the operator is looking. The node answers such a
 * push with a shrug: applyInbounds finds no adapter for the (protocol, engine)
 * pair, logs a line and returns 200 with `skipped`, so the panel shows a
 * deployed profile and the subscription keeps handing out an endpoint nobody
 * is listening on.
 */
export class ProfileDoesNotRunOnNodeError extends Error {
  constructor(
    public nodeName: string,
    public detail: string,
  ) {
    super(`Node "${nodeName}" cannot serve this profile: ${detail}`);
    this.name = 'ProfileDoesNotRunOnNodeError';
  }
}

/**
 * The gate, on what the node REPORTED and nothing else.
 *
 * A node that has never checked in is allowed through. The only other thing to
 * judge by is `Node.protocol`, and that is a label for which adapter is primary,
 * not a list of what the node can serve: multi-protocol nodes are normal here
 * and the schema says so. A first version of this gate fell back to it and
 * refused 23 pairs the suite builds on purpose.
 *
 * So this is quiet on today's fleet and becomes real when the agents are
 * updated, which is the only order in which it can be right.
 *
 * ⚠ Save path ONLY. Never call this from a push, a rebuild or an upgrade: see
 * the comment on PublicBindingDto.rendersProfile.
 */
function assertNodeRendersProfile(
  node: { name: string; cores: unknown },
  profile: { protocol: string; engine: string | null },
): void {
  const { ok, engines, wanted } = renderableAtSave(node, profile);
  if (ok) return;
  throw new ProfileDoesNotRunOnNodeError(
    node.name,
    `it needs the ${wanted} core and this node reports ${
      engines.length ? engines.join(', ') : 'no core at all'
    }`,
  );
}

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
  assertNodeRendersProfile(node, profile);

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
  // Slice 30: every new binding ships with one Default host so the
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
  // Skip bindings whose node was soft-deleted, otherwise DeployProfileModal
  // / profile cards would carry phantom rows from removed nodes.
  const where: Prisma.ProfileNodeBindingWhereInput = { node: { deletedAt: null } };
  if (q.nodeId) where.nodeId = q.nodeId;
  if (q.profileId) where.profileId = q.profileId;
  const rows = await prisma.profileNodeBinding.findMany({
    where,
    orderBy: [{ nodeId: 'asc' }, { port: 'asc' }],
    // For rendersProfile. Two columns each, not the whole rows: this list is
    // read on every profile card.
    include: {
      node: { select: { cores: true } },
      profile: { select: { protocol: true, engine: true } },
    },
  });
  return rows.map((b) => mapBinding(b, nodeRendersProfile(b.node, b.profile)));
}

export async function getBindingById(id: string): Promise<PublicBindingDto> {
  const b = await prisma.profileNodeBinding.findUnique({
    where: { id },
    include: {
      node: { select: { cores: true } },
      profile: { select: { protocol: true, engine: true } },
    },
  });
  if (!b) throw new BindingNotFoundError(id);
  return mapBinding(b, nodeRendersProfile(b.node, b.profile));
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
 * Shallow merge is intentional, overrides should mention specific top-level
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

