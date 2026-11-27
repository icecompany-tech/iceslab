import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { transportForBinding } from '../profiles/profiles.transport.js';
import { checkSniConsistency } from '../profiles/host-fields.js';
// Reused rather than redefined so the operator gets the same wording whichever
// route created the binding.
import {
  assertBindingFitsNode,
  assertPortFreeOfOthers,
  NodeNotFoundError,
  ProfileDoesNotRunOnNodeError,
  ProfileEngineNotForTransportError,
  PortHeldByCascadeError,
  PortHeldByCoreServiceError,
  PortInUseError,
  ProfileNotFoundError,
  updateBinding,
} from '../profiles/profiles.service.js';
import { mapHost, type HostReach, type PublicHostDto } from './hosts.mapper.js';
import { HOST_LINK_FIELDS, hostConfigChangedAt } from './hosts.freshness.js';
import { anyChanged } from '../../lib/util/same-value.js';
import { isUniqueViolationOn } from '../../lib/util/unique-violation.js';
import type { Transport } from '@iceslab/shared';
import { getHiddenCascadeNodes, type HidingCascade } from '../cascades/cascade.service.js';
import { assertCoreOnNode } from '../nodes/node-core-gate.js';
import { AdapterSlotTakenError, MieruMtuMismatchError } from '../nodes/node-adapter-slot.js';
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

/**
 * A-215: the node a host's binding sits on. A host decides who reaches the
 * inbound (a squad narrowed to hosts reaches a binding through them), so a
 * host created, toggled or removed moves the node's user reach; host.changed
 * carries the node and the push hands its users out again.
 */
async function nodeOfBinding(bindingId: string): Promise<string | undefined> {
  return (await prisma.profileNodeBinding.findUnique({ where: { id: bindingId }, select: { nodeId: true } }))?.nodeId;
}

export class BindingNotFoundError extends Error {
  constructor(public id: string) {
    super(`Binding ${id} not found`);
    this.name = 'BindingNotFoundError';
  }
}

// Re-exported so the routes layer can catch them without importing the profiles
// module, which it otherwise has no business knowing about.
export {
  AdapterSlotTakenError,
  MieruMtuMismatchError,
  NodeNotFoundError,
  ProfileDoesNotRunOnNodeError,
  ProfileEngineNotForTransportError,
  PortHeldByCascadeError,
  PortHeldByCoreServiceError,
  PortInUseError,
  ProfileNotFoundError,
};

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
    select: { profile: { select: { protocol: true, config: true, engine: true } } },
  });
  if (!binding) return; // caller already raises BindingNotFoundError

  await assertSniMatchesProfileConfig({
    protocol: binding.profile.protocol,
    config: binding.profile.config,
    engine: binding.profile.engine,
    sniOverride: opts.sniOverride,
    securityLayer: opts.securityLayer,
  });
}

/** Same check against a profile already in hand, so create can run it before
 *  opening a transaction rather than after writing the binding. The engine
 *  decides which names serve (A-159: one, the first, on sing-box). */
async function assertSniMatchesProfileConfig(opts: {
  protocol: string;
  config: unknown;
  engine: string | null | undefined;
  sniOverride: string | null | undefined;
  securityLayer: string | null | undefined;
}): Promise<void> {
  if (!opts.sniOverride) return;
  const verdict = checkSniConsistency(opts);
  if (verdict) throw new SniMismatchError(opts.sniOverride, verdict.expected);
}

// ───── CRUD ─────

/** Which cascade hides the node under a binding, or null. See PublicHostDto. */
async function hidingCascadeOfBinding(bindingId: string): Promise<HidingCascade | null> {
  const b = await prisma.profileNodeBinding.findUnique({ where: { id: bindingId }, select: { nodeId: true } });
  if (!b) return null;
  return (await getHiddenCascadeNodes()).get(b.nodeId) ?? null;
}

/** A-122: the four rows a host's link is made of, by their link stamps. */
const LINK_STAMPS = {
  nodeId: true,
  linkChangedAt: true,
  profile: { select: { linkChangedAt: true } },
  node: { select: { linkChangedAt: true } },
} as const;

function linkStampsOf(h: {
  linkChangedAt: Date;
  binding: { linkChangedAt: Date; profile: { linkChangedAt: Date }; node: { linkChangedAt: Date } };
}) {
  return {
    host: h.linkChangedAt,
    binding: h.binding.linkChangedAt,
    profile: h.binding.profile.linkChangedAt,
    node: h.binding.node.linkChangedAt,
  };
}

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
    include: { binding: { select: LINK_STAMPS } },
    orderBy: [{ priority: 'asc' }, { bindingId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const [reach, hidden] = await Promise.all([reachByHost(rows.map((r) => r.id)), getHiddenCascadeNodes()]);
  return rows.map((r) =>
    mapHost(
      r,
      reach.get(r.id) ?? { squads: 0, users: 0 },
      hostConfigChangedAt(linkStampsOf(r)).toISOString(),
      hidden.get(r.binding.nodeId) ?? null,
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
    include: { binding: { select: LINK_STAMPS } },
  });
  if (!h) throw new HostNotFoundError(id);
  return mapHost(
    h,
    undefined,
    hostConfigChangedAt(linkStampsOf(h)).toISOString(),
    (await getHiddenCascadeNodes()).get(h.binding.nodeId) ?? null,
  );
}

export async function createHost(input: CreateHostInput): Promise<PublicHostDto> {
  // Everything that can be rejected is checked BEFORE anything is written, and
  // the two writes then happen together. Creating the binding first and letting
  // the host fail afterwards would leave an orphan the operator cannot see or
  // remove: the new UI has no screen for bindings at all.
  // A new binding under the host passes the bindings route's gate there
  // (assertBindingFitsNode), sing-box's fields included.
  const plan = await planHostCreate(input);

  await assertSniMatchesProfileConfig({
    protocol: plan.profile.protocol,
    config: plan.profile.config,
    engine: plan.profile.engine,
    sniOverride: input.sniOverride,
    securityLayer: input.securityLayer,
  });

  // A-150: an override equal to what clients get anyway (the binding's public
  // port, else its listen port) is not stored. The create screen sent the
  // binding's own port as one, and that copy then shadowed every later move
  // of the listen port in the subscription.
  const existingBinding = plan.bindingId
    ? await prisma.profileNodeBinding.findUnique({
        where: { id: plan.bindingId },
        select: { port: true, publicPort: true },
      })
    : null;
  const listenPort = existingBinding ? (existingBinding.publicPort ?? existingBinding.port) : plan.port;
  const hostData = {
    remark: input.remark,
    priority: input.priority,
    enabled: input.enabled,
    addressOverride: input.addressOverride ?? null,
    portOverride: input.portOverride != null && input.portOverride !== listenPort ? input.portOverride : null,
    sniOverride: input.sniOverride ?? null,
    hostHeaderOverride: input.hostHeaderOverride ?? null,
    pathOverride: input.pathOverride ?? null,
    fingerprintOverride: input.fingerprintOverride ?? null,
    alpn: input.alpn,
    allowInsecure: input.allowInsecure,
    securityLayer: input.securityLayer,
    disableForFormats: input.disableForFormats,
    serverDescription: input.serverDescription ?? null,
    isHidden: input.isHidden,
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
          transport: transportForBinding(plan.profile),
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
  eventBus.emit('host.changed', { nodeId: await nodeOfBinding(created.bindingId) });
  return mapHost(created, undefined, undefined, await hidingCascadeOfBinding(created.bindingId));
}

/**
 * Work out which binding a new host will hang off, and prove the request is
 * satisfiable, without writing anything.
 *
 * Returns either an existing `bindingId` (given directly, or found for the
 * profile, node and port) or the pieces needed to create one. An existing
 * binding on that port is REUSED rather than rejected: a second host on the
 * same node and port is an ordinary thing to want (a CDN-fronted variant next
 * to the direct one), and erroring there would push the operator back into the
 * dead end this whole change exists to remove. Another port is another binding
 * of the same pair (A-259).
 */
async function planHostCreate(input: CreateHostInput): Promise<{
  bindingId: string | null;
  profile: { id: string; protocol: string; config: unknown; engine?: string | null };
  nodeId?: string;
  port?: number;
}> {
  if (input.bindingId) {
    const binding = await prisma.profileNodeBinding.findUnique({
      where: { id: input.bindingId },
      select: { id: true, profile: { select: { id: true, protocol: true, config: true, engine: true } } },
    });
    if (!binding) throw new BindingNotFoundError(input.bindingId);
    return { bindingId: binding.id, profile: binding.profile };
  }

  const profileId = input.profileId!;
  const nodeId = input.nodeId!;
  const port = input.port!;

  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile) throw new ProfileNotFoundError(profileId);

  const node = await prisma.node.findFirst({ where: { id: nodeId, deletedAt: null } });
  if (!node) throw new NodeNotFoundError(nodeId);

  // A-259: a profile may sit on one node on several ports, one binding each.
  // The host goes onto the binding of THIS port when there is one; a port the
  // pair does not have yet is a new binding (the checks below). Before, the
  // pair's one binding was reused whatever port was asked, and a host asked for
  // on 8443 landed silently on 443.
  const existing = await prisma.profileNodeBinding.findFirst({
    where: { profileId, nodeId, port },
    select: { id: true },
  });
  // A second host on a binding that already exists is still a host put on this
  // node, and the node's core is what serves it.
  if (existing) {
    assertCoreOnNode(node, profile);
    return { bindingId: existing.id, profile };
  }

  // A port is taken per TRANSPORT across all profiles on that node, so a clash
  // names the profile squatting on the same socket rather than saying "taken"
  // about a number. REALITY on 443/TCP does not stand in the way of Hysteria2
  // on 443/UDP, and this used to refuse exactly that.
  const transport = transportForBinding(profile);
  const clash = await prisma.profileNodeBinding.findUnique({
    where: { nodeId_port_transport: { nodeId, port, transport } },
    select: { profile: { select: { name: true } } },
  });
  if (clash) throw new PortInUseError(port, node.name, clash.profile.name, transport);
  // And the two claimants no index can see: a cascade leg in another table, and
  // a service one of the node's cores opened for itself. Creating a host
  // creates the binding under it, so this route reaches the same socket the
  // bindings route does and has to ask the same question.
  await assertPortFreeOfOthers(nodeId, port, transport, node.name);
  // After the ports, before anything is written (docs/plan/core-lifecycle.md 6):
  // the bindings route's gate, whole (A-161). It had the core and the subnet
  // and not the engine list, so a sing-box profile went onto a node that had
  // reported its engines without sing-box. sing-box's own fields are part of
  // it too, which used to be asked separately in createHost.
  await assertBindingFitsNode(node, profile);

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

  /**
   * A-150: the port on this screen is the port the node LISTENS on, and it
   * belongs to the binding. Before that the field wrote portOverride, the node
   * kept the old port, and every client was handed a port nothing listened on.
   *
   * A-259: what moves is said by `portMove` (confirmSharedPort true reads as
   * 'binding'):
   *   - 'binding': the binding, every host on it with it (updateBinding: the
   *     port checks of a binding, then the push);
   *   - 'host', the default: this host alone. Onto the profile's binding of
   *     the new port on this node when there is one; a host alone on its
   *     binding with no such binding moves the binding itself; otherwise a new
   *     binding of the profile on that port (the checks of a new binding; its
   *     public host and overrides copied, no public port), and the host goes
   *     onto it. A binding left without a host is removed, as a host's delete
   *     removes it. The host's move is one transaction.
   * HOST_PORT_SHARED is not answered any more: a host moves alone unless asked.
   */
  const binding = await prisma.profileNodeBinding.findUniqueOrThrow({
    where: { id: existing.bindingId },
    select: { port: true, publicPort: true, hosts: { select: { id: true } } },
  });
  const moving = input.port !== undefined && input.port !== binding.port;
  const mode = input.portMove ?? (input.confirmSharedPort === true ? 'binding' : 'host');
  let hostMove: HostMovePlan | null = null;
  if (moving && mode === 'host') {
    hostMove = await planHostMove(existing.bindingId, input.port!, binding.hosts.length === 1);
  }
  if (moving && !hostMove) await updateBinding(existing.bindingId, { port: input.port! });
  // What clients get without an override: the binding's public port, else the
  // port the node listens on (subscription.service.ts, basePort). A public port
  // equal to the old listen port was a copy, and updateBinding dropped it with
  // the move (A-150 tail). A host moved to another binding takes that one's.
  const publicPort = hostMove
    ? hostMove.publicPort
    : moving && binding.publicPort === binding.port
      ? null
      : binding.publicPort;
  const listenPort = publicPort ?? (moving ? input.port! : binding.port);

  const data: Prisma.HostUpdateInput = {};
  if (input.remark !== undefined) data.remark = input.remark;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.addressOverride !== undefined) data.addressOverride = input.addressOverride;
  // An override equal to the listen port is no override: stored as null, so a
  // later move of the listen port is not shadowed by a stale copy of the old
  // one (the trace the create screen used to leave, A-150).
  if (input.portOverride !== undefined) {
    data.portOverride = input.portOverride === listenPort ? null : input.portOverride;
  } else if (moving && existing.portOverride === listenPort) {
    data.portOverride = null;
  }
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
  if (input.serverDescription !== undefined) data.serverDescription = input.serverDescription;
  if (input.isHidden !== undefined) data.isHidden = input.isHidden;
  // A-122: the stamp moves when a value that reaches the client really
  // changed, every host field but priority (HOST_LINK_FIELDS).
  if (anyChanged(existing, data as Partial<typeof existing>, HOST_LINK_FIELDS)) data.linkChangedAt = new Date();
  // A host on another binding is on another port: its link changed (A-122).
  if (hostMove) data.linkChangedAt = new Date();

  if (!hostMove) {
    const updated = await prisma.host.update({ where: { id }, data });
    eventBus.emit('host.changed', { nodeId: await nodeOfBinding(updated.bindingId) });
    return mapHost(updated, undefined, undefined, await hidingCascadeOfBinding(updated.bindingId));
  }

  const plan = hostMove;
  const { updated, createdBinding, removedBinding } = await prisma
    .$transaction(async (tx) => {
      let targetId = plan.targetBindingId;
      let createdBinding: { id: string; profileId: string; nodeId: string } | null = null;
      if (!targetId) {
        createdBinding = await tx.profileNodeBinding.create({ data: plan.newBinding!, select: { id: true, profileId: true, nodeId: true } });
        targetId = createdBinding.id;
      }
      const updated = await tx.host.update({ where: { id }, data: { ...data, binding: { connect: { id: targetId } } } });
      const left = await tx.host.count({ where: { bindingId: existing.bindingId } });
      let removedBinding: { id: string; profileId: string; nodeId: string } | null = null;
      if (left === 0) {
        removedBinding = await tx.profileNodeBinding.delete({
          where: { id: existing.bindingId },
          select: { id: true, profileId: true, nodeId: true },
        });
      }
      return { updated, createdBinding, removedBinding };
    })
    .catch((err: unknown) => {
      // The port checked free above and taken before the insert: the same
      // answer the check gives (A-257).
      if (isUniqueViolationOn(err, 'profile_node_bindings_node_id_port_transport_key', ['node_id', 'port', 'transport'])) {
        throw new PortInUseError(plan.port, plan.nodeName, plan.profileName, plan.transport);
      }
      throw err;
    });

  // The host first, then the bindings: binding.* re-push the node, by then
  // the subscription caches (dropped by host.changed, A-165) know the move.
  eventBus.emit('host.changed', { nodeId: plan.nodeId });
  if (createdBinding) eventBus.emit('binding.created', { bindingId: createdBinding.id, profileId: createdBinding.profileId, nodeId: createdBinding.nodeId });
  if (removedBinding) eventBus.emit('binding.deleted', { bindingId: removedBinding.id, profileId: removedBinding.profileId, nodeId: removedBinding.nodeId });
  return mapHost(updated, undefined, undefined, await hidingCascadeOfBinding(updated.bindingId));
}

/** A-259: where a host moved alone to another port goes, checked, unwritten. */
interface HostMovePlan {
  port: number;
  nodeId: string;
  nodeName: string;
  profileName: string;
  transport: Transport;
  /** The profile's binding of that port on the node, when there is one. */
  targetBindingId: string | null;
  /** Otherwise the binding to create. */
  newBinding: Prisma.ProfileNodeBindingUncheckedCreateInput | null;
  /** What the host's clients dial without an override, on the target. */
  publicPort: number | null;
}

/**
 * Where a host moved alone to `port` goes (portMove 'host'), or null when it
 * is the binding that moves: a host alone on its binding with no binding of
 * the profile on that port moves its binding, nothing to split.
 */
async function planHostMove(bindingId: string, port: number, alone: boolean): Promise<HostMovePlan | null> {
  const from = await prisma.profileNodeBinding.findUniqueOrThrow({
    where: { id: bindingId },
    select: {
      profileId: true,
      nodeId: true,
      publicHost: true,
      overrides: true,
      enabled: true,
      profile: { select: { id: true, name: true, protocol: true, engine: true, config: true, awgProtocol: true } },
      node: true,
    },
  });
  const target = await prisma.profileNodeBinding.findFirst({
    where: { profileId: from.profileId, nodeId: from.nodeId, port },
    select: { id: true, port: true, publicPort: true },
  });
  const transport = transportForBinding(from.profile, from.overrides);
  const base = { port, nodeId: from.nodeId, nodeName: from.node.name, profileName: from.profile.name, transport };
  if (target) {
    return { ...base, targetBindingId: target.id, newBinding: null, publicPort: target.publicPort };
  }
  if (alone) return null;

  // A new binding of the profile on this node: the checks every new binding
  // goes through (planHostCreate, createBinding).
  const clash = await prisma.profileNodeBinding.findUnique({
    where: { nodeId_port_transport: { nodeId: from.nodeId, port, transport } },
    select: { profile: { select: { name: true } } },
  });
  if (clash) throw new PortInUseError(port, from.node.name, clash.profile.name, transport);
  await assertPortFreeOfOthers(from.nodeId, port, transport, from.node.name);
  await assertBindingFitsNode(from.node, from.profile, from.overrides);
  return {
    ...base,
    targetBindingId: null,
    newBinding: {
      profileId: from.profileId,
      nodeId: from.nodeId,
      port,
      transport,
      enabled: from.enabled,
      publicHost: from.publicHost,
      publicPort: null,
      overrides: from.overrides === null ? Prisma.JsonNull : (from.overrides as Prisma.InputJsonValue),
    },
    publicPort: null,
  };
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
  // Read before the delete: the binding may go with its last host.
  const nodeId = await nodeOfBinding(existing.bindingId);

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

  eventBus.emit('host.changed', { nodeId });
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
 * outside the list are untouched. The drag-and-drop UI sends
 * the full panel inventory in the desired order.
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
