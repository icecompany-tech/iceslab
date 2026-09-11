import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { checkSniConsistency } from '../profiles/host-fields.js';
// Reused rather than redefined so the operator gets the same wording whichever
// route created the binding.
import {
  NodeNotFoundError,
  PortInUseError,
  ProfileNotFoundError,
} from '../profiles/profiles.service.js';
import { mapHost, type HostReach, type PublicHostDto } from './hosts.mapper.js';
import { hostConfigChangedAt } from './hosts.freshness.js';
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

// Re-exported so the routes layer can catch them without importing the profiles
// module, which it otherwise has no business knowing about.
export { NodeNotFoundError, PortInUseError, ProfileNotFoundError };

/** An SNI override REALITY will never complete a handshake for. Saving it
 *  yields a host that looks healthy and hands out URLs that cannot connect,
 *  so we refuse instead of storing it. */
export class SniMismatchError extends Error {
  constructor(
    public sni: string,
    public expected: string[],
  ) {
    super(
      `SNI "${sni}" is not served by this profile. REALITY answers only for: ${expected.join(', ')}`,
    );
    this.name = 'SniMismatchError';
  }
}

// ───── Validation ─────

/**
 * Reject an SNI the node will not answer for.
 *
 * The check lives here rather than in the zod schema because it needs the
 * profile behind the binding: `hosts.schemas.ts` sees a bare string and has no
 * way to know which server names the inbound was built with. See
 * `checkSniConsistency` for the cases deliberately left alone (CDN-terminated
 * TLS, self-steal, non-REALITY profiles).
 */
async function assertSniMatchesProfile(opts: {
  bindingId: string;
  sniOverride: string | null | undefined;
  securityLayer: string | null | undefined;
}): Promise<void> {
  if (!opts.sniOverride) return;
  const binding = await prisma.profileNodeBinding.findUnique({
    where: { id: opts.bindingId },
    select: { profile: { select: { protocol: true, config: true } } },
  });
  if (!binding) return; // caller already raises BindingNotFoundError

  await assertSniMatchesProfileConfig({
    protocol: binding.profile.protocol,
    config: binding.profile.config,
    sniOverride: opts.sniOverride,
    securityLayer: opts.securityLayer,
  });
}

/** Same check against a profile already in hand, so create can run it before
 *  opening a transaction rather than after writing the binding. */
async function assertSniMatchesProfileConfig(opts: {
  protocol: string;
  config: unknown;
  sniOverride: string | null | undefined;
  securityLayer: string | null | undefined;
}): Promise<void> {
  if (!opts.sniOverride) return;
  const verdict = checkSniConsistency(opts);
  if (verdict) throw new SniMismatchError(opts.sniOverride, verdict.expected);
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
    // The two rows under the host are part of its config: an operator who moved
    // the port edited the BINDING, and every client's link changed with it.
    include: { binding: { select: { updatedAt: true, profile: { select: { updatedAt: true } } } } },
    orderBy: [{ bindingId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  });
  const reach = await reachByHost(rows.map((r) => r.id));
  return rows.map((r) =>
    mapHost(
      r,
      reach.get(r.id) ?? { squads: 0, users: 0 },
      hostConfigChangedAt({
        host: r.updatedAt,
        binding: r.binding.updatedAt,
        profile: r.binding.profile.updatedAt,
      }).toISOString(),
    ),
  );
}

/**
 * Squads and people a host actually reaches, per host, in one query.
 *
 * Counting has to happen here rather than on the screen: deduplicating people
 * across squads needs their ids, and the squad list only carries totals. See
 * HostReach for the miscount this replaces.
 *
 * The squad narrowing rule matches the one the subscription applies (GroupHost):
 * no rows for a squad means it hands out every host of its profiles, any rows
 * mean exactly those. Getting this wrong in the other direction would be worse
 * than a wrong number, since the screen would promise reach a subscriber does
 * not have.
 *
 * Deleted people are left out through the LEFT JOIN condition, so the count is
 * of `users.id` rather than of the membership row: a squad whose members are all
 * deleted reports zero rather than its historical size.
 */
async function reachByHost(hostIds: string[]): Promise<Map<string, HostReach>> {
  if (hostIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ host_id: string; squads: number; users: number }[]>`
    SELECT h.id                        AS host_id,
           COUNT(DISTINCT gp.group_id)::int AS squads,
           COUNT(DISTINCT u.id)::int        AS users
    FROM hosts h
    JOIN profile_node_bindings b ON b.id = h.binding_id
    JOIN group_profiles gp       ON gp.profile_id = b.profile_id
    LEFT JOIN group_members gm   ON gm.group_id = gp.group_id
    LEFT JOIN users u            ON u.id = gm.user_id AND u.deleted_at IS NULL
    WHERE h.id IN (${Prisma.join(hostIds)})
      AND (
        NOT EXISTS (SELECT 1 FROM group_hosts x WHERE x.group_id = gp.group_id)
        OR EXISTS (SELECT 1 FROM group_hosts y
                   WHERE y.group_id = gp.group_id AND y.host_id = h.id)
      )
    GROUP BY h.id
  `;
  return new Map(rows.map((r) => [r.host_id, { squads: r.squads, users: r.users }]));
}

export async function getHostById(id: string): Promise<PublicHostDto> {
  const h = await prisma.host.findUnique({
    where: { id },
    include: { binding: { select: { updatedAt: true, profile: { select: { updatedAt: true } } } } },
  });
  if (!h) throw new HostNotFoundError(id);
  return mapHost(
    h,
    undefined,
    hostConfigChangedAt({
      host: h.updatedAt,
      binding: h.binding.updatedAt,
      profile: h.binding.profile.updatedAt,
    }).toISOString(),
  );
}

export async function createHost(input: CreateHostInput): Promise<PublicHostDto> {
  // Everything that can be rejected is checked BEFORE anything is written, and
  // the two writes then happen together. Creating the binding first and letting
  // the host fail afterwards would leave an orphan the operator cannot see or
  // remove: the new UI has no screen for bindings at all.
  const plan = await planHostCreate(input);

  await assertSniMatchesProfileConfig({
    protocol: plan.profile.protocol,
    config: plan.profile.config,
    sniOverride: input.sniOverride,
    securityLayer: input.securityLayer,
  });

  const hostData = {
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
  };

  const { created, newBinding } = await prisma.$transaction(async (tx) => {
    let bindingId = plan.bindingId;
    let newBinding: { id: string; profileId: string; nodeId: string } | null = null;
    if (!bindingId) {
      const b = await tx.profileNodeBinding.create({
        data: {
          profileId: plan.profile.id,
          nodeId: plan.nodeId!,
          port: plan.port!,
          enabled: true,
        },
        select: { id: true, profileId: true, nodeId: true },
      });
      bindingId = b.id;
      newBinding = b;
    }
    const created = await tx.host.create({ data: { bindingId, ...hostData } });
    return { created, newBinding };
  });

  // A binding created here skips ensureDefaultHost on purpose: the host the
  // caller asked for IS this binding's first host, and seeding another one
  // would hand every user a duplicate endpoint.
  if (newBinding) {
    eventBus.emit('binding.created', {
      bindingId: newBinding.id,
      profileId: newBinding.profileId,
      nodeId: newBinding.nodeId,
    });
  }
  // A host IS an endpoint in the subscription, so every mutation here changes
  // what users are handed.
  eventBus.emit('host.changed', {});
  return mapHost(created);
}

/**
 * Work out which binding a new host will hang off, and prove the request is
 * satisfiable, without writing anything.
 *
 * Returns either an existing `bindingId` (given directly, or found for the
 * profile/node pair) or the pieces needed to create one. An existing binding
 * for the pair is REUSED rather than rejected: a second host on the same node
 * is an ordinary thing to want (a CDN-fronted variant next to the direct one),
 * and erroring there would push the operator back into the dead end this whole
 * change exists to remove.
 */
async function planHostCreate(input: CreateHostInput): Promise<{
  bindingId: string | null;
  profile: { id: string; protocol: string; config: unknown };
  nodeId?: string;
  port?: number;
}> {
  if (input.bindingId) {
    const binding = await prisma.profileNodeBinding.findUnique({
      where: { id: input.bindingId },
      select: { id: true, profile: { select: { id: true, protocol: true, config: true } } },
    });
    if (!binding) throw new BindingNotFoundError(input.bindingId);
    return { bindingId: binding.id, profile: binding.profile };
  }

  const profileId = input.profileId!;
  const nodeId = input.nodeId!;
  const port = input.port!;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, protocol: true, config: true },
  });
  if (!profile) throw new ProfileNotFoundError(profileId);

  const node = await prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!node) throw new NodeNotFoundError(nodeId);

  const existing = await prisma.profileNodeBinding.findUnique({
    where: { profileId_nodeId: { profileId, nodeId } },
    select: { id: true },
  });
  if (existing) return { bindingId: existing.id, profile };

  // The port is unique per node across ALL profiles, so a clash names the
  // profile squatting on it rather than saying "taken".
  const clash = await prisma.profileNodeBinding.findUnique({
    where: { nodeId_port: { nodeId, port } },
    select: { profile: { select: { name: true } } },
  });
  if (clash) throw new PortInUseError(port, node.name, clash.profile.name);

  return { bindingId: null, profile, nodeId, port };
}

export async function updateHost(
  id: string,
  input: UpdateHostInput,
): Promise<PublicHostDto> {
  const existing = await prisma.host.findUnique({ where: { id } });
  if (!existing) throw new HostNotFoundError(id);

  // Check the values the row will END UP with: an update that only flips
  // securityLayer away from 'tls' can invalidate an SNI saved earlier under
  // the CDN exemption, so neither field can be validated on its own.
  await assertSniMatchesProfile({
    bindingId: existing.bindingId,
    sniOverride:
      input.sniOverride !== undefined ? input.sniOverride : existing.sniOverride,
    securityLayer:
      input.securityLayer !== undefined ? input.securityLayer : existing.securityLayer,
  });

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
  eventBus.emit('host.changed', {});
  return mapHost(updated);
}

/**
 * Delete a host, and with it the binding when that was its last one.
 *
 * The binding used to survive, on the reasoning that tearing an inbound off a
 * live node should not be a side effect of removing one client line. Two things
 * settled the argument the other way (operator's call, 2026-07-30):
 *
 *   - the leftover was INVISIBLE. No screen lists bindings, so an operator who
 *     deleted their only host saw a node claiming to serve something, could not
 *     find what, and could not remove it;
 *   - it still held the port. A second profile asking for the same port on that
 *     node was refused, naming a profile that appeared to serve nothing.
 *
 * So "no hosts" now means "nothing on the node", which is the model the panel
 * shows everywhere else. The cost is real and belongs in the confirmation the
 * operator reads: removing the inbound rewrites the node's config, and xray
 * restarts, dropping live sessions on that node's OTHER inbounds too.
 */
export async function deleteHost(id: string): Promise<void> {
  const existing = await prisma.host.findUnique({ where: { id } });
  if (!existing) throw new HostNotFoundError(id);

  const orphanedBinding = await prisma.$transaction(async (tx) => {
    await tx.host.delete({ where: { id } });
    const left = await tx.host.count({ where: { bindingId: existing.bindingId } });
    if (left > 0) return null;
    // Read before deleting: the event needs profile and node, and the row is
    // about to be gone.
    const binding = await tx.profileNodeBinding.findUnique({
      where: { id: existing.bindingId },
      select: { id: true, profileId: true, nodeId: true },
    });
    if (!binding) return null;
    await tx.profileNodeBinding.delete({ where: { id: binding.id } });
    return binding;
  });

  eventBus.emit('host.changed', {});
  // Ordered after host.changed on purpose: this one re-pushes the node's
  // inbound set, so it should run once the subscription caches already know
  // the host is gone.
  if (orphanedBinding) {
    eventBus.emit('binding.deleted', {
      bindingId: orphanedBinding.id,
      profileId: orphanedBinding.profileId,
      nodeId: orphanedBinding.nodeId,
    });
  }
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
  // Priority decides which endpoint a client tries first, so a reorder changes
  // the subscription even though no field the user typed did.
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
