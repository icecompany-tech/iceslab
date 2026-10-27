import type { EngineName, Transport } from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { isUniqueViolationOn } from '../../lib/util/unique-violation.js';
import { anyChanged } from '../../lib/util/same-value.js';
import { BINDING_LINK_FIELDS, PROFILE_LINK_FIELDS } from '../hosts/hosts.freshness.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import { ensureAllSquad } from '../squads/squads.system.js';
import {
  PROTOCOL_CONFIG_SCHEMAS,
} from '../inbounds/inbounds.schemas.js';
import { ensureDefaultHost } from '../hosts/hosts.service.js';
import {
  generateSsServerPsk,
  pskFitsMethod,
} from './ss-helpers.js';
import { adapterSlot, assertAdapterSlotFree } from '../nodes/node-adapter-slot.js';
import {
  AWG_PROTOCOL_NOT_AWG_MESSAGE,
  engineServesSubprotocol,
  engineValidForProtocol,
  SINGBOX_XRAY_FAMILY_CODE,
  SINGBOX_XRAY_FAMILY_MESSAGE,
  singboxRefusesXrayField,
  type SingboxXrayField,
  VMESS_REALITY_MESSAGE,
  vmessOnReality,
  withXraySecurityDefault,
} from './profiles.schemas.js';
import { ZodError } from 'zod';
import {
  effectiveEngineOf,
  nodeRendersProfile,
  renderableAtSave,
} from '../nodes/node-engines.js';
import {
  assertAwgProtocolOnNode,
  assertAwgSubnetFree,
  assertCoreOnNode,
  profileAwgProtocol,
} from '../nodes/node-core-gate.js';
import { stripInapplicableTransportFields } from '../inbounds/xray-transport-fields.js';
import { transportForBinding } from './profiles.transport.js';
import { portOwnersOnNode, type PortOwner } from '../nodes/node-ports.js';
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

/** An edit that would put a socks or http profile on the sing-box engine. The
 *  create path refuses the same pair in the schema (engineServesSubprotocol). */
export class ProfileEngineNotForSubprotocolError extends Error {
  readonly code = 'INVALID';
  constructor() {
    super('socks and http are served by the xray engine only');
    this.name = 'ProfileEngineNotForSubprotocolError';
  }
}
/** An edit that gives a generation to a profile that is not AmneziaWG. The
 *  create path refuses the same in the schema. */
export class ProfileAwgProtocolNotAwgError extends Error {
  readonly code = 'INVALID';
  readonly path = ['awgProtocol'];
  constructor() {
    super(AWG_PROTOCOL_NOT_AWG_MESSAGE);
    this.name = 'ProfileAwgProtocolNotAwgError';
  }
}
/** An xray-family profile on sing-box with a field sing-box cannot serve
 *  (singboxRefusesXrayField). `path` names the field, as a schema issue would. */
export class ProfileEngineNotForTransportError extends Error {
  /** Its own code, not INVALID: the socks/http refusal shares the path, and a
   *  screen must not have to tell the two apart by their prose. */
  readonly code = SINGBOX_XRAY_FAMILY_CODE;
  readonly path: [string, SingboxXrayField];
  constructor(field: SingboxXrayField, where: 'config' | 'overrides' = 'config') {
    super(SINGBOX_XRAY_FAMILY_MESSAGE);
    this.name = 'ProfileEngineNotForTransportError';
    this.path = [where, field];
  }
}
/**
 * The port is taken ON THAT TRANSPORT.
 *
 * The transport is in the message and in the fields because without it the
 * sentence is wrong in the way that matters: "port 443 is in use" is what the
 * panel used to say to somebody adding Hysteria2 beside REALITY, and it was
 * not true. It is true only of the same socket.
 *
 * Machine fields travel beside the prose so the panel can say this in the
 * operator's language, with the demultiplexer explanation that a bare "port in
 * use" cannot carry.
 */
export class PortInUseError extends Error {
  /**
   * The code the panel switches on, and the conflicts it draws from.
   *
   * Both are here rather than only in the prose because the screen is
   * bilingual and the words belong to it: the panel holds one dictionary for
   * these, in the operator's language and in the right case inside a sentence,
   * and a second dictionary on this side would drift from it within a week.
   * The English message stays as the fallback for anything that has no screen.
   *
   * `conflicts` is the same union the port check answers with, so a screen that
   * can draw one can draw the other without a second shape to learn.
   */
  readonly code = 'PORT_TAKEN_PROFILE';
  readonly conflicts: PortOwner[];

  constructor(
    public port: number,
    public nodeName: string,
    public conflictProfile: string,
    public transport: Transport,
  ) {
    super(
      `Port ${port}/${transport.toUpperCase()} on node "${nodeName}" is already used by profile ` +
        `"${conflictProfile}". A second ${transport.toUpperCase()} protocol on the same port needs a ` +
        `demultiplexer, which the panel does not do yet. Pick a different port.`,
    );
    this.name = 'PortInUseError';
    this.conflicts = [{ kind: 'profile', name: conflictProfile, port, transport }];
  }
}

/**
 * The port is taken by a CASCADE, not by another profile.
 *
 * A cascade leg listens on the receiving node at LINK_PORT_BASE + step, and
 * nothing stopped a binding from being saved onto it: the uniqueness key covers
 * bindings against bindings and cannot reach cascade_links. The node then fails
 * to bring one of the two listeners up, in its journal, hours after the save.
 *
 * Separate from PortInUseError because the remedy is different: there is no
 * "other profile" to look at, and the operator has to know a cascade owns that
 * range before they go hunting for a profile that does not exist.
 */
export class PortHeldByCascadeError extends Error {
  readonly code = 'PORT_TAKEN_CASCADE';
  readonly conflicts: PortOwner[];

  constructor(
    public port: number,
    public nodeName: string,
    public cascadeName: string,
  ) {
    super(
      `Port ${port}/TCP on node "${nodeName}" is the inter-hop link port of cascade ` +
        `"${cascadeName}". Cascade link ports are assigned automatically from 24000 up; ` +
        `pick a port outside that range for this profile.`,
    );
    this.name = 'PortHeldByCascadeError';
    this.conflicts = [{ kind: 'cascade', name: cascadeName, port, transport: 'tcp' }];
  }
}

/**
 * The port belongs to a service one of the node's cores opened for itself.
 *
 * The third remedy, and the bleakest: there is no profile to move and no
 * cascade to re-plan, the number is simply spoken for. Its own class because
 * the operator's next step is different again, and because the panel says so in
 * words built from `ownerKey` rather than from a name anybody chose.
 *
 * Refused at the save although nothing in the database could have stopped it:
 * the node is the only party that knows these ports, and without this the save
 * succeeded and the core failed to bind, in the journal, hours later.
 */
export class PortHeldByCoreServiceError extends Error {
  readonly code = 'PORT_TAKEN_CORE_SERVICE';

  constructor(
    public port: number,
    public nodeName: string,
    public ownerKey: string,
    public transport: Transport,
    public conflicts: PortOwner[],
  ) {
    super(
      `Port ${port}/${transport.toUpperCase()} on node "${nodeName}" is held by a core service ` +
        `(${ownerKey}). That one cannot be moved: pick a different port for this profile.`,
    );
    this.name = 'PortHeldByCoreServiceError';
  }
}

/**
 * The edit moves deployed bindings onto a socket somebody else already holds.
 *
 * Only `xray` can do this: switching `network` to kcp moves every binding of
 * the profile from TCP to UDP, and a port free on one is not free on the other.
 * The profile edit is therefore refused as a whole, before anything is written,
 * rather than saved with the bindings left describing the wrong socket.
 *
 * Every blocked pair is named, not just the first: a profile on eight nodes
 * would otherwise be fixed one 409 at a time.
 */
export class TransportMoveBlockedError extends Error {
  constructor(
    public transport: Transport,
    public conflicts: { nodeName: string; port: number; conflictProfile: string }[],
  ) {
    super(
      `Moving this profile to ${transport.toUpperCase()} would collide on: ` +
        conflicts
          .map(
            (c) =>
              `node "${c.nodeName}" port ${c.port}/${transport.toUpperCase()} (held by profile "${c.conflictProfile}")`,
          )
          .join('; ') +
        `. Change the port on those nodes first, or leave the transport as it is.`,
    );
    this.name = 'TransportMoveBlockedError';
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

/**
 * A-284: the port hopping range of a hysteria profile. Both bounds or
 * neither, and the end above the start. The schema cannot say it (a
 * `.refine()` would take the config out of the discriminated union), and the
 * check lived only in the per-node inbound service, unmounted since slice 27:
 * a reversed or half range was saved and every format handed it to clients
 * as it was. A schema issue on the field, so create and edit answer alike
 * (400 VALIDATION_ERROR, path config.portHoppingStart or .portHoppingEnd).
 *
 * Whether the range lies inside the one the node redirects is NOT checked:
 * that range is given to bootstrap-hysteria.sh (--hysteria-port-range) and
 * kept on the node (/etc/hysteria/port-range); no agent report carries it to
 * the panel. If one ever does, the check belongs here.
 */
export function assertPortHoppingRange(protocol: string, config: unknown): void {
  if (protocol !== 'hysteria') return;
  const c = (config ?? {}) as { portHoppingStart?: unknown; portHoppingEnd?: unknown };
  const start = typeof c.portHoppingStart === 'number' ? c.portHoppingStart : undefined;
  const end = typeof c.portHoppingEnd === 'number' ? c.portHoppingEnd : undefined;
  const issue = (field: 'portHoppingStart' | 'portHoppingEnd', message: string) =>
    new ZodError([{ code: 'custom', message, path: ['config', field], input: config }]);
  if (start === undefined && end !== undefined) {
    throw issue('portHoppingStart', 'port hopping needs both ends of the range: the start is missing');
  }
  if (start !== undefined && end === undefined) {
    throw issue('portHoppingEnd', 'port hopping needs both ends of the range: the end is missing');
  }
  if (start !== undefined && end !== undefined && end <= start) {
    throw issue('portHoppingEnd', `the end of the port hopping range (${end}) must be above its start (${start})`);
  }
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
  assertPortHoppingRange(input.protocol, configToStore);

  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.profile.create({
      data: {
        name: input.name,
        protocol: input.protocol,
        engine: input.engine ?? null,
        // The schema refuses a generation on any other protocol.
        awgProtocol: input.protocol === 'amneziawg' ? (input.awgProtocol ?? null) : null,
        description: input.description ?? null,
        config: configToStore as never,
        enabled: input.enabled,
      },
    });
    // Slice 26 invariant: every new profile auto-attaches to "All" squad. The
    // row itself is repaired first on a database that lost it.
    await ensureAllSquad(tx);
    await tx.groupProfile.upsert({
      where: { groupId_profileId: { groupId: ALL_SQUAD_ID, profileId: p.id } },
      create: { groupId: ALL_SQUAD_ID, profileId: p.id },
      update: {},
    });
    return p;
  }).catch((err: unknown) => {
    // The check above is read-then-insert: a create racing it loses here
    // (A-257), a 409 in words instead of a 500.
    if (isUniqueViolationOn(err, 'profiles_name_key', ['name'])) throw new ProfileNameTakenError(input.name);
    throw err;
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
        select: { node: true },
      });
      const next = { ...existing, engine: input.engine ?? null };
      for (const b of deployed) {
        // The core's own report too (A-161): a node whose sing-box is a
        // refused version took the move with the engine list alone.
        assertCoreOnNode(b.node, next);
        assertNodeRendersProfile(b.node, next);
      }
    }
  }

  // t07-1. Absent is no edit; null puts the profile back on 1.x.
  if (input.awgProtocol !== undefined) {
    if (existing.protocol !== 'amneziawg') throw new ProfileAwgProtocolNotAwgError();
    data.awgProtocol = input.awgProtocol;
    // Moving to 3.1 is the same save-time question as binding a 3.1 profile,
    // asked of every node it is deployed on. Back to 1.x is served by both
    // module generations and asks nothing.
    const next = { protocol: existing.protocol, awgProtocol: input.awgProtocol };
    if (profileAwgProtocol(next) === 3 && profileAwgProtocol(existing) !== 3) {
      const deployed = await prisma.profileNodeBinding.findMany({
        where: { profileId: id, node: { deletedAt: null } },
        select: { node: { select: { name: true, cores: true } } },
      });
      for (const b of deployed) assertAwgProtocolOnNode(b.node, next);
    }
  }

  /**
   * The adapter slot again (A-055), for a profile that MOVES to another
   * adapter: a new engine, or another AmneziaWG generation. On every node it
   * is bound to, the adapter it moves onto may already serve another binding,
   * and the agent would silently replace one with the other. Asked of each
   * node, before anything is written.
   */
  const nextSlotOf = {
    id,
    protocol: existing.protocol,
    engine: input.engine !== undefined ? input.engine : existing.engine,
    awgProtocol: input.awgProtocol !== undefined ? input.awgProtocol : existing.awgProtocol,
    config: input.config !== undefined ? input.config : existing.config,
  };
  // mieru shares its adapter, but one MTU per process: an MTU edit on a
  // node with another mieru inbound is the same question.
  const mieruRetuned = existing.protocol === 'mieru' && input.config !== undefined;
  if (adapterSlot(nextSlotOf) !== adapterSlot(existing) || mieruRetuned) {
    const deployed = await prisma.profileNodeBinding.findMany({
      where: { profileId: id, node: { deletedAt: null } },
      select: { id: true, overrides: true, node: { select: { id: true, name: true } } },
    });
    // A-259: each binding against the rest of its node, the profile's own other
    // bindings there included, all of them counted in the slot they move to.
    for (const b of deployed) await assertAdapterSlotFree(b.node, nextSlotOf, b.overrides, b.id);
  }

  if (input.config !== undefined) {
    const schema = PROTOCOL_CONFIG_SCHEMAS[
      existing.protocol as keyof typeof PROTOCOL_CONFIG_SCHEMAS
    ];
    if (!schema) throw new Error(`Unknown protocol ${existing.protocol}`);
    // A-230: the same vmess rule as on create (profiles.schemas.ts): no
    // security is none, an explicit reality is refused in words.
    const isXray = existing.protocol === 'xray';
    const parsed = schema.parse(isXray ? withXraySecurityDefault(input.config) : input.config);
    if (isXray && vmessOnReality(parsed)) {
      throw new ZodError([{ code: 'custom', message: VMESS_REALITY_MESSAGE, path: ['config', 'security'], input: input.config }]);
    }
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
    /**
     * Shadowsocks keeps its server key the same way (A-028).
     *
     * The profile form has no serverPsk field, so every save sent a config
     * without one and the stored key was overwritten by nothing: the node then
     * got a new key on the next push, or none, and every 2022 client lost the
     * server half of its password. Absent is not a value, it is no edit. Kept
     * when it still fits the cipher; a method change to a different key length
     * needs a new key anyway, and gets one rather than a key the node refuses.
     */
    if (existing.protocol === 'shadowsocks') {
      const incoming = parsed as { method: string; serverPsk?: string };
      if (!incoming.serverPsk) {
        const stored = (existing.config ?? {}) as { serverPsk?: string };
        incoming.serverPsk =
          stored.serverPsk && pskFitsMethod(stored.serverPsk, incoming.method)
            ? stored.serverPsk
            : generateSsServerPsk(incoming.method);
      }
    }
    // After parse, so schema defaults are filled in first and only then the
    // fields belonging to other transports are dropped.
    data.config = (
      existing.protocol === 'xray'
        ? stripInapplicableTransportFields(parsed as Record<string, unknown>)
        : parsed
    ) as never;
    // The config as it will be stored: an edit sends the whole config, so one
    // bound changed against the other stored is the pair checked here.
    assertPortHoppingRange(existing.protocol, data.config);
  }

  // The pair as it will be stored: an edit may change either half alone, and a
  // socks profile moved to sing-box is refused just as one created there is.
  const nextEngine = input.engine !== undefined ? input.engine : existing.engine;
  const nextConfig = data.config !== undefined ? data.config : existing.config;
  if (!engineServesSubprotocol(existing.protocol, nextEngine, nextConfig)) {
    throw new ProfileEngineNotForSubprotocolError();
  }
  // Same pair, same reading: a TLS profile moved to sing-box, or a sing-box
  // profile edited to TLS, is refused here rather than by the node's push.
  const refused = singboxRefusesXrayField(existing.protocol, nextEngine, nextConfig);
  if (refused) throw new ProfileEngineNotForTransportError(refused);
  // What the node is pushed is the profile merged with each binding's
  // overrides, and an override may pin a network of its own.
  if (existing.protocol === 'xray' && nextEngine === 'singbox') {
    const deployed = await prisma.profileNodeBinding.findMany({
      where: { profileId: id },
      select: { overrides: true },
    });
    for (const b of deployed) {
      const f = singboxRefusesXrayField('xray', 'singbox', resolveBindingConfig(nextConfig, b.overrides));
      if (f) throw new ProfileEngineNotForTransportError(f, 'overrides');
    }
  }

  /**
   * A config edit can move every deployed binding onto another socket.
   *
   * `network` = kcp is the whole of it: xray then listens on UDP, and the
   * stored `transport` is half of the uniqueness key. Left alone, the rows
   * would keep claiming TCP while the node listens on UDP, which is the exact
   * lie the column exists to prevent. So the new value is computed per binding
   * (overrides merged, because a binding may pin its own `network`), checked
   * against what is already on that socket, and written together with the
   * profile in one transaction: either the profile and all its bindings agree,
   * or nothing moved.
   */
  const moves: { id: string; port: number; nodeId: string; transport: Transport }[] = [];
  if (data.config !== undefined) {
    const bindings = await prisma.profileNodeBinding.findMany({
      where: { profileId: id },
      select: { id: true, port: true, nodeId: true, transport: true, overrides: true },
    });
    const nextProfile = { protocol: existing.protocol, config: data.config as unknown };
    for (const b of bindings) {
      const next = transportForBinding(nextProfile, b.overrides);
      if (next !== b.transport) moves.push({ ...b, transport: next });
    }
  }

  if (moves.length > 0) {
    // Asked before the write, not caught after it, because the key says only
    // that something collided, and the operator needs to know which node.
    const taken = await prisma.profileNodeBinding.findMany({
      where: {
        profileId: { not: id },
        OR: moves.map((m) => ({ nodeId: m.nodeId, port: m.port, transport: m.transport })),
      },
      select: {
        port: true,
        nodeId: true,
        transport: true,
        node: { select: { name: true } },
        profile: { select: { name: true } },
      },
    });
    if (taken.length > 0) {
      throw new TransportMoveBlockedError(
        taken[0]!.transport as Transport,
        taken.map((t) => ({
          nodeName: t.node.name,
          port: t.port,
          conflictProfile: t.profile.name,
        })),
      );
    }
  }

  // t07-6 (ARCH 26.09): a new subnet, or a move to the other generation, is
  // the same question as binding the profile anew, asked of every node it is
  // on: does it now overlap the other generation's interface there.
  if (existing.protocol === 'amneziawg') {
    const subnetOf = (c: unknown) => ((c ?? {}) as { subnet?: string }).subnet;
    const nextAwg = input.awgProtocol !== undefined ? input.awgProtocol : existing.awgProtocol;
    const moved =
      subnetOf(nextConfig) !== subnetOf(existing.config) ||
      profileAwgProtocol({ protocol: 'amneziawg', awgProtocol: nextAwg }) !== profileAwgProtocol(existing);
    if (moved) {
      const deployed = await prisma.profileNodeBinding.findMany({
        where: { profileId: id, node: { deletedAt: null } },
        select: { node: { select: { id: true, name: true } } },
      });
      for (const b of deployed) {
        await assertAwgSubnetFree(b.node, { id, protocol: 'amneziawg', awgProtocol: nextAwg, config: nextConfig });
      }
    }
  }

  // A-122: the profile's link stamp moves only when a value that reaches the
  // client really changed (PROFILE_LINK_FIELDS); a rename or a description
  // does not. A moved binding's transport is in its link too.
  if (anyChanged(existing, data as Partial<typeof existing>, PROFILE_LINK_FIELDS)) data.linkChangedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    for (const m of moves) {
      await tx.profileNodeBinding.update({
        where: { id: m.id },
        data: { transport: m.transport, linkChangedAt: new Date() },
      });
    }
    return tx.profile.update({
      where: { id },
      data,
      include: { _count: { select: { bindings: true } } },
    });
  }).catch((err: unknown) => {
    // A rename racing the check above (A-257).
    if (input.name !== undefined && isUniqueViolationOn(err, 'profiles_name_key', ['name'])) {
      throw new ProfileNameTakenError(input.name);
    }
    throw err;
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
  /**
   * The prose is BUILT FROM the fields, not written beside them, so the two
   * cannot drift apart.
   *
   * The fields are there because the panel is bilingual and this sentence is
   * English. Two 409s already answer a Russian interface in English prose; this
   * is the third, and the price of that habit grows. Nothing reads them yet:
   * when error localisation happens, the sentence can be rebuilt in the
   * operator's language without touching the contract.
   *
   * `reportedEngines` is always an array and never absent, because this refusal
   * is only reachable AFTER a node has reported: one that never checked in is
   * let through. An empty array therefore means "reported, and runs nothing",
   * not "we do not know".
   */
  constructor(
    public nodeName: string,
    public neededEngine: EngineName,
    public reportedEngines: EngineName[],
    /** Whether waiting will change the answer: the node is set up for this core
     *  and has simply not reported it yet. False means waiting is pointless,
     *  and saying otherwise would send the operator to watch a poll that will
     *  never help. */
    public canWait: boolean,
  ) {
    super(
      `Node "${nodeName}" cannot serve this profile: it needs the ${neededEngine} core and ` +
        `this node reports ${
          reportedEngines.length ? reportedEngines.join(', ') : 'no core at all'
        }.` +
        // canWait is "the agent declares the engine and reports no core for
        // it" (since E42 the declaration comes from the agent's env, not from
        // an edit here). Waiting helps only right after the bootstrap; past
        // that the bootstrap failed or the binary went (A-161, 22.10: the
        // sentence promised the next poll would fix it, and it never did).
        (canWait
          ? ` The node's agent declares ${neededEngine} but reports no such core. If its` +
            ` bootstrap has just run, the next status poll will show it; otherwise run the` +
            ` ${neededEngine} bootstrap on the node again.`
          : ''),
    );
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
  node: {
    name: string;
    cores: unknown;
    protocol: string;
    singboxEngine: boolean;
    intendedEngines?: string[] | null;
  },
  profile: { protocol: string; engine: string | null },
): void {
  const { ok, engines, wanted, justEnabled } = renderableAtSave(node, profile);
  if (ok) return;
  // "Not yet" and "no" read the same to an operator unless we say which one
  // this is, so `canWait` carries the difference into both the prose and the
  // fields.
  throw new ProfileDoesNotRunOnNodeError(node.name, wanted, engines, justEnabled);
}

/**
 * The other half of the port question, the half no index can answer.
 *
 * Two claimants live outside the uniqueness key: a cascade leg, in another
 * table, and a service a core opened for itself, which only the node knows.
 * Both are asked here, at the save, because the alternative is a save that
 * succeeds and a listener that never comes up.
 *
 * ⚠ Only the transport asked about. A cascade leg is always TCP, a core service
 * says what it is, and a UDP binding on 24000 is a different socket that is
 * genuinely free. Refusing it would be the same untruth the transport key was
 * added to stop telling.
 *
 * Exported because the legacy inbound save has to ask exactly the same
 * question, and two copies of it would answer differently the first time one
 * of them learned something.
 */
export async function assertPortFreeOfOthers(
  nodeId: string,
  port: number,
  transport: Transport,
  nodeName?: string,
  exceptBindingId?: string,
): Promise<void> {
  const owners = (await portOwnersOnNode(nodeId, [port], { exceptBindingId })).filter(
    (o) => o.transport === transport,
  );
  const cascade = owners.find((o) => o.kind === 'cascade');
  const service = owners.find((o) => o.kind === 'core-service');
  if (!cascade && !service) return;

  const name =
    nodeName ??
    (await prisma.node.findUnique({ where: { id: nodeId }, select: { name: true } }))?.name ??
    nodeId;
  // The cascade first when both hold it: it is the one the operator can
  // actually act on, and a dead end reads worse than a fixable conflict.
  if (cascade) throw new PortHeldByCascadeError(port, name, cascade.name);
  if (service?.kind === 'core-service') {
    throw new PortHeldByCoreServiceError(port, name, service.ownerKey, transport, owners);
  }
}

/**
 * A binding's overrides must not pin what sing-box cannot serve: the node is
 * pushed the profile merged with them (resolveBindingConfig). The path points
 * at the override when it is the override that carries the field.
 */
export function assertSingboxServesBinding(
  profile: { protocol: string; engine: string | null; config: unknown },
  overrides: unknown,
): void {
  const f = singboxRefusesXrayField(
    profile.protocol,
    profile.engine,
    resolveBindingConfig(profile.config, overrides),
  );
  if (!f) return;
  const own = overrides && typeof overrides === 'object' && f in (overrides as object);
  throw new ProfileEngineNotForTransportError(f, own ? 'overrides' : 'config');
}

/**
 * The node's facts for a new binding, one function for every way a binding is
 * made (A-161, 22.10): the bindings route and the host form, which creates
 * the binding under a new host. The host path asked the core and the subnet
 * but not the engine list, so a sing-box profile went onto a node that had
 * reported its engines without sing-box: the node answered the push with
 * `skipped`, and the subscription handed out an endpoint nobody served.
 *
 * In this order: the core by the node's own report first (the specific answer,
 * with the command), then the engine list, what sing-box can serve, the
 * AmneziaWG subnet and the adapter slot (A-055).
 */
export async function assertBindingFitsNode(
  node: Parameters<typeof assertCoreOnNode>[0] & Parameters<typeof assertNodeRendersProfile>[0] &
    Parameters<typeof assertAwgSubnetFree>[0] & Parameters<typeof assertAdapterSlotFree>[0],
  profile: Parameters<typeof assertCoreOnNode>[1] & Parameters<typeof assertNodeRendersProfile>[1] &
    Parameters<typeof assertSingboxServesBinding>[0] & Parameters<typeof assertAwgSubnetFree>[1] &
    Parameters<typeof assertAdapterSlotFree>[1],
  overrides?: unknown,
): Promise<void> {
  assertCoreOnNode(node, profile);
  assertNodeRendersProfile(node, profile);
  assertSingboxServesBinding(profile, overrides);
  await assertAwgSubnetFree(node, profile);
  await assertAdapterSlotFree(node, profile, overrides);
}

export async function createBinding(input: CreateBindingInput): Promise<PublicBindingDto> {
  const profile = await prisma.profile.findUnique({ where: { id: input.profileId } });
  if (!profile) throw new ProfileNotFoundError(input.profileId);
  const node = await prisma.node.findFirst({
    where: { id: input.nodeId, deletedAt: null },
  });
  if (!node) throw new NodeNotFoundError(input.nodeId);

  // Which socket this binding will take. Everything below asks about the port
  // AND the transport, because those are two different resources: 443/TCP and
  // 443/UDP are not the same listener, and the panel used to refuse the pair.
  const transport = transportForBinding(profile, input.overrides);

  // Pre-flight uniqueness check, for a message better than a constraint name.
  const portConflict = await prisma.profileNodeBinding.findUnique({
    where: {
      nodeId_port_transport: { nodeId: input.nodeId, port: input.port, transport },
    },
    include: { profile: { select: { name: true } } },
  });
  if (portConflict) {
    throw new PortInUseError(input.port, node.name, portConflict.profile.name, transport);
  }
  await assertPortFreeOfOthers(input.nodeId, input.port, transport, node.name);
  // A-259: a second binding of the profile on this node is allowed, on its own
  // port, as its own inbound. What still refuses it is the adapter (a
  // single-inbound core holds one), inside the gate below.
  // The node's facts, the same gate as the host form's (assertBindingFitsNode).
  await assertBindingFitsNode(node, profile, input.overrides);

  const created = await prisma.profileNodeBinding.create({
    data: {
      profileId: input.profileId,
      nodeId: input.nodeId,
      port: input.port,
      publicHost: input.publicHost ?? null,
      publicPort: storedPublicPort(input.publicPort, input.port),
      overrides: (input.overrides as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      transport,
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

/** A-150 tail: a public port equal to the listen port is no public port. */
export function storedPublicPort(publicPort: number | null | undefined, port: number): number | null {
  return publicPort == null || publicPort === port ? null : publicPort;
}

export async function updateBinding(
  id: string,
  input: UpdateBindingInput,
): Promise<PublicBindingDto> {
  const existing = await prisma.profileNodeBinding.findUnique({
    where: { id },
    include: { profile: { select: { protocol: true, config: true, engine: true } } },
  });
  if (!existing) throw new BindingNotFoundError(id);

  // The overrides can move an xray binding onto or off kcp, which changes the
  // socket it takes, so the transport is recomputed from what the row will be
  // after this edit rather than from what it was.
  const nextOverrides = input.overrides !== undefined ? input.overrides : existing.overrides;
  assertSingboxServesBinding(existing.profile, nextOverrides);
  // A-199: an MTU set through the binding's overrides is the node's mieru MTU
  // too, and one mita process holds one. Beside another mieru inbound a
  // different MTU is refused here, or the agent answers 500 on every push.
  if (existing.profile.protocol === 'mieru' && input.overrides !== undefined) {
    const node = await prisma.node.findUniqueOrThrow({ where: { id: existing.nodeId }, select: { id: true, name: true } });
    await assertAdapterSlotFree(node, { ...existing.profile, id: existing.profileId }, nextOverrides, existing.id);
  }
  const transport = transportForBinding(existing.profile, nextOverrides);
  const nextPort = input.port ?? existing.port;

  if (nextPort !== existing.port || transport !== existing.transport) {
    const portConflict = await prisma.profileNodeBinding.findUnique({
      where: {
        nodeId_port_transport: { nodeId: existing.nodeId, port: nextPort, transport },
      },
      include: {
        profile: { select: { name: true } },
        node: { select: { name: true } },
      },
    });
    if (portConflict && portConflict.id !== id) {
      throw new PortInUseError(
        nextPort,
        portConflict.node.name,
        portConflict.profile.name,
        transport,
      );
    }
    await assertPortFreeOfOthers(existing.nodeId, nextPort, transport, undefined, id);
  }

  const data: Prisma.ProfileNodeBindingUpdateInput = {};
  if (input.port !== undefined) data.port = input.port;
  if (input.publicHost !== undefined) data.publicHost = input.publicHost;
  // A-150 tail: the public port is stored only when it differs from the listen
  // port. The node wizard sent publicPort = port, and that copy stayed behind
  // when the listen port moved, so clients kept the old port.
  if (input.publicPort !== undefined) {
    data.publicPort = storedPublicPort(input.publicPort, nextPort);
  } else if (nextPort !== existing.port && existing.publicPort === existing.port) {
    data.publicPort = null;
  }
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.overrides !== undefined) {
    data.overrides =
      input.overrides === null
        ? Prisma.JsonNull
        : (input.overrides as Prisma.InputJsonValue);
  }
  // Always written, not only when it changed: the column is part of the
  // uniqueness key, and a row whose transport drifted from its config is a row
  // the key is protecting the wrong way round.
  data.transport = transport;

  // A-122: every binding field reaches the client; the stamp moves when one
  // really changed. Read from the input, not `data`, where a cleared override
  // is Prisma.JsonNull rather than null.
  const nextLink: Record<string, unknown> = { transport };
  if (data.port !== undefined) nextLink.port = data.port;
  if (data.publicHost !== undefined) nextLink.publicHost = data.publicHost;
  if (data.publicPort !== undefined) nextLink.publicPort = data.publicPort;
  if (data.enabled !== undefined) nextLink.enabled = data.enabled;
  if (input.overrides !== undefined) nextLink.overrides = input.overrides;
  if (anyChanged(existing, nextLink as Partial<typeof existing>, BINDING_LINK_FIELDS)) data.linkChangedAt = new Date();

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

