import type { Cascade } from '@/lib/domain/cascades';
import type { Host } from '@/lib/domain/hosts';
import type { Binding } from '@/lib/domain/profiles';
import type { Squad, SquadExitAclEntry } from '@/lib/domain/squads';

/**
 * A squad's cascades as one thing each (owner, 24.09: «I want to see cascades,
 * not assemble ru-01 and se-01 by hand»), read from what the API answers today.
 *
 * v4 cascades come as `positions` and `directions` with `hops: []`, so the
 * entry is position 0 (its whole pool) and the ways out are the directions
 * (with their own pools); `hops` is read only for a cascade that has no
 * positions. The previous block read hops and showed every v4 cascade empty
 * and amber.
 *
 * HANDED OUT IS A FACT. A cascade works for a squad exactly when the squad
 * hands out a host on one of its entry nodes: the subscription builder hangs
 * the direction profiles off the entry host, and with no entry host there is no
 * line to carry a tag.
 *
 * ON OR OFF IS THE SQUAD'S CHOICE, one `exitAcl` entry per cascade, three
 * states (BACK 24.09, squads.schemas.ts), keyed by DIRECTION since 39c266a
 * (A-149):
 *   no entry             every direction;
 *   directionIds [x, …]  only those directions;
 *   directionIds []      off: no line of the cascade is built for the squad.
 * A legacy hop cascade has no directions and keeps the node list
 * (`exitNodeIds`), the only key it has.
 */

/** Which list of an entry names the exits of this cascade. */
export type AclField = 'directionIds' | 'exitNodeIds';

/** The ids an entry allows, whichever list it carries; empty is «off». */
export function aclIdsOf(entry: SquadExitAclEntry): string[] {
  return entry.directionIds && entry.directionIds.length > 0 ? entry.directionIds : (entry.exitNodeIds ?? []);
}

/**
 * The acl as the screen keeps and sends it: one list per entry. The server
 * answers both lists for a direction entry (`exitNodeIds` for showing pools);
 * kept as is, the node list would go back on the wire and compare as a change.
 */
export function canonicalAcl(acl: SquadExitAclEntry[]): SquadExitAclEntry[] {
  return acl.map((e) =>
    e.directionIds && e.directionIds.length > 0
      ? { cascadeId: e.cascadeId, directionIds: e.directionIds }
      : e.exitNodeIds && e.exitNodeIds.length > 0
        ? { cascadeId: e.cascadeId, exitNodeIds: e.exitNodeIds }
        : { cascadeId: e.cascadeId, directionIds: [] },
  );
}

export interface SquadCascadeExit {
  key: string;
  tag: number;
  countryCode: string | null;
  nodeIds: string[];
  nodeNames: string[];
  /** What the acl names this exit by: the direction id, or the hop's nodes on a legacy cascade. */
  aclIds: string[];
  /** Handed out: every direction when the cascade has no acl entry, none when it is off. */
  allowed: boolean;
}

export interface SquadCascadeEntryNode {
  id: string;
  name: string;
  /** Ports of the enabled hosts on this node, the ones the squad hands out first. */
  ports: { port: number; handedOut: boolean }[];
}

export type NotHandedOut =
  /** No enabled host of a granted profile runs on any entry node. */
  | 'no-granted-host'
  /** There is one, and the squad's host restriction leaves it out. */
  | 'host-not-picked'
  /** The cascade has no entry node at all. */
  | 'no-entry';

export interface SquadCascade {
  id: string;
  name: string;
  entry: SquadCascadeEntryNode[];
  /**
   * Countries of the entry nodes, where a squad's users come out when the
   * cascade is off and the entry host stays a plain server. Null when any entry
   * node has no country: part of the answer is not the answer.
   */
  entryCountries: string[] | null;
  exits: SquadCascadeExit[];
  /** The acl list this cascade is keyed by: directions, or nodes on a legacy hop cascade. */
  aclField: AclField;
  /** Switched off for this squad (an empty list): nothing of it is built. */
  off: boolean;
  /** On, with an acl entry: only `allowed` exits go out. */
  exitsNarrowed: boolean;
  handedOut: boolean;
  notHandedOut: NotHandedOut | null;
  /** The entry host «выдать вход» adds to the restriction, when that is the fix. */
  entryHostToAdd: string | null;
  /** Policies granted on this cascade by other squads and not by this one. */
  policiesToOffer: { id: string; name: string }[];
  /**
   * A-277: off or narrowed, the node policy's rules into this cascade do not
   * take the squad's users either (BACK-2 5465a512): `gated`. An entry on
   * hysteria or AmneziaWG cannot tell users apart, a rule there acts on all:
   * `gated-except-chain`.
   *
   * A-283: said only when an entry node's policy has such a rule
   * (`nodePolicyLeadsInto`); with none, null. `unknown` when the node policies
   * or the entry nodes' policy are not known: not «no rule», the warning stays
   * as «cannot tell». Null when the squad takes every exit.
   */
  nodePolicyNote: 'gated' | 'gated-except-chain' | 'unknown' | null;
}

/**
 * Entry protocols whose users reach the cascade through the chain, where the
 * entry's xray cannot tell one user from another: the server's list
 * (cascade.validation.ts:64, ENTRIES_ONLY_THROUGH_CHAIN).
 */
const CHAIN_ONLY_ENTRIES: readonly string[] = ['hysteria', 'amneziawg'];

export interface SquadState {
  profileIds: string[];
  hostIds: string[];
  /** Whether the squad restricts hosts; with no restriction every host of every
   *  granted profile goes out. */
  restricted: boolean;
  exitAcl: SquadExitAclEntry[];
  policyIds: string[];
}

interface World {
  cascades: Cascade[];
  hosts: Pick<Host, 'id' | 'bindingId' | 'enabled' | 'portOverride'>[];
  bindings: Pick<Binding, 'id' | 'nodeId' | 'profileId' | 'port' | 'publicPort'>[];
  /** `policyId` absent: the list did not say which node policy the node runs. */
  nodes: { id: string; name: string; countryCode: string | null; policyId?: string | null }[];
  /** Every squad, for the policies granted on a cascade; the edited one is skipped by id. */
  squads: Pick<Squad, 'id' | 'profileIds' | 'hostIds' | 'policyIds'>[];
  policies: { id: string; name: string; ordinal: number }[];
  /** The node policies (`/api/node-policies`); null while not known (pending or failed). */
  nodePolicies: NodePolicyRules[] | null;
}

export interface NodePolicyRules {
  id: string;
  rules: { enabled: boolean; action: { kind: string; directionId: string | null } }[];
}

/**
 * A-283: does a node policy on an entry node send traffic into one of these
 * directions (an enabled `cascade` rule). A «yes» needs one such rule; a «no»
 * needs every entry node's policy known: a node missing from the list, a list
 * without `policyId`, a policy not among the loaded ones or no list at all is
 * null, «cannot tell».
 */
export function nodePolicyLeadsInto(
  entryNodeIds: string[],
  directionIds: string[],
  nodes: World['nodes'],
  nodePolicies: NodePolicyRules[] | null,
): boolean | null {
  const into = new Set(directionIds);
  const policyOf = (id: string) => nodePolicies?.find((p) => p.id === id);
  let complete = nodePolicies !== null;
  for (const id of entryNodeIds) {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.policyId === undefined) {
      complete = false;
      continue;
    }
    if (node.policyId === null) continue;
    const policy = policyOf(node.policyId);
    if (!policy) {
      complete = false;
      continue;
    }
    if (policy.rules.some((r) => r.enabled && r.action.kind === 'cascade' && r.action.directionId !== null && into.has(r.action.directionId))) {
      return true;
    }
  }
  return complete ? false : null;
}

/** Entry node ids and directions of a cascade, v4 first, hops for the old ones. */
export function cascadeShape(c: Pick<Cascade, 'hops' | 'positions' | 'directions'>): {
  entryNodeIds: string[];
  directions: { key: string; tag: number; countryCode: string | null; nodeIds: string[] }[];
  /** v4: the directions are rows with ids the acl names; legacy: hops, named by node. */
  byDirection: boolean;
} {
  if (c.positions.length > 0) {
    const entry = c.positions.find((p) => p.position === 0);
    return {
      byDirection: true,
      entryNodeIds: (entry?.nodeIds ?? []).filter(Boolean),
      directions: c.directions.map((d) => ({
        key: d.id,
        tag: d.tag,
        countryCode: d.countryCode || null,
        nodeIds: d.nodeIds.filter(Boolean),
      })),
    };
  }
  const hops = [...c.hops].sort((a, b) => a.position - b.position);
  return {
    byDirection: false,
    entryNodeIds: hops[0] ? [hops[0].nodeId] : [],
    directions: hops.slice(1).map((h, i) => ({ key: h.id, tag: i + 1, countryCode: null, nodeIds: [h.nodeId] })),
  };
}

/** The cascade's entry speaks hysteria or AmneziaWG (v4 positions only; a legacy hop cascade has no entry protocol). */
function chainOnlyEntry(c: Pick<Cascade, 'positions'>): boolean {
  const entry = c.positions.find((p) => p.position === 0);
  return entry?.entryProtocol != null && CHAIN_ONLY_ENTRIES.includes(entry.entryProtocol);
}

function nodePolicyNoteOf(
  gated: boolean,
  c: Pick<Cascade, 'positions'>,
  shape: ReturnType<typeof cascadeShape>,
  world: World,
): SquadCascade['nodePolicyNote'] {
  if (!gated) return null;
  // A legacy hop cascade has no directions a rule could name: its keys are hops.
  const directionIds = shape.byDirection ? shape.directions.map((d) => d.key) : [];
  const leads = nodePolicyLeadsInto(shape.entryNodeIds, directionIds, world.nodes, world.nodePolicies);
  if (leads === null) return 'unknown';
  if (!leads) return null;
  return chainOnlyEntry(c) ? 'gated-except-chain' : 'gated';
}

/** Does this squad hand out an enabled host on one of these nodes. */
function handsOutOn(
  squad: Pick<SquadState, 'profileIds' | 'hostIds' | 'restricted'>,
  nodeIds: ReadonlySet<string>,
  hosts: World['hosts'],
  bindingById: ReadonlyMap<string, World['bindings'][number]>,
): boolean {
  const granted = new Set(squad.profileIds);
  return hosts.some((h) => {
    if (!h.enabled) return false;
    const b = bindingById.get(h.bindingId);
    if (!b || !nodeIds.has(b.nodeId) || !granted.has(b.profileId)) return false;
    return squad.restricted ? squad.hostIds.includes(h.id) : true;
  });
}

export function squadCascades(squadId: string | null, state: SquadState, world: World): SquadCascade[] {
  const bindingById = new Map(world.bindings.map((b) => [b.id, b] as const));
  const nodeById = new Map(world.nodes.map((n) => [n.id, n] as const));
  const granted = new Set(state.profileIds);

  return world.cascades
    .filter((c) => c.enabled)
    .map((c) => {
      const shape = cascadeShape(c);
      const entrySet = new Set(shape.entryNodeIds);

      // Enabled hosts on the entry nodes, with whether this squad hands each out.
      const entryHosts = world.hosts.filter((h) => {
        const b = bindingById.get(h.bindingId);
        return h.enabled && b !== undefined && entrySet.has(b.nodeId);
      });
      const goesOut = (h: World['hosts'][number]) => {
        const b = bindingById.get(h.bindingId)!;
        return granted.has(b.profileId) && (state.restricted ? state.hostIds.includes(h.id) : true);
      };
      const entry = shape.entryNodeIds.map((id) => ({
        id,
        name: nodeById.get(id)?.name ?? id.slice(0, 8),
        ports: entryHosts
          .filter((h) => bindingById.get(h.bindingId)!.nodeId === id)
          .map((h) => {
            const b = bindingById.get(h.bindingId)!;
            return { port: h.portOverride ?? b.publicPort ?? b.port, handedOut: goesOut(h) };
          }),
      }));

      const handedOut = entryHosts.some(goesOut);
      // What would open it: a host of a granted profile the restriction leaves out.
      const pickable = entryHosts.find((h) => granted.has(bindingById.get(h.bindingId)!.profileId));
      const notHandedOut: NotHandedOut | null = handedOut
        ? null
        : shape.entryNodeIds.length === 0
          ? 'no-entry'
          : pickable && state.restricted
            ? 'host-not-picked'
            : 'no-granted-host';

      const acl = state.exitAcl.find((e) => e.cascadeId === c.id);
      const allowedIds = acl ? aclIdsOf(acl) : [];
      const off = acl !== undefined && allowedIds.length === 0;
      const entryCodes = shape.entryNodeIds.map((id) => nodeById.get(id)?.countryCode ?? null);
      const exits = shape.directions.map((d) => {
        // A direction on a named outbound has no nodes; by direction id it is
        // as grantable as any other (A-149), which by node it never was.
        const aclIds = shape.byDirection ? [d.key] : d.nodeIds;
        return {
          key: d.key,
          tag: d.tag,
          countryCode: d.countryCode ?? nodeById.get(d.nodeIds[0] ?? '')?.countryCode ?? null,
          nodeIds: d.nodeIds,
          nodeNames: d.nodeIds.map((id) => nodeById.get(id)?.name ?? id.slice(0, 8)),
          aclIds,
          allowed: acl ? aclIds.some((id) => allowedIds.includes(id)) : true,
        };
      });

      // Policies other squads that reach this cascade grant on it, which this
      // squad does not: the offer «grant "No ads" to this squad».
      const offered = new Set<string>();
      for (const s of world.squads) {
        if (s.id === squadId) continue;
        const reaches = handsOutOn(
          { profileIds: s.profileIds, hostIds: s.hostIds, restricted: s.hostIds.length > 0 },
          entrySet,
          world.hosts,
          bindingById,
        );
        if (reaches) for (const p of s.policyIds) if (!state.policyIds.includes(p)) offered.add(p);
      }

      return {
        id: c.id,
        name: c.name,
        entry,
        entryCountries:
          entryCodes.length > 0 && entryCodes.every((cc): cc is string => Boolean(cc))
            ? [...new Set(entryCodes.map((cc) => cc.toUpperCase()))]
            : null,
        exits,
        aclField: shape.byDirection ? 'directionIds' : 'exitNodeIds',
        off,
        exitsNarrowed: acl !== undefined && !off,
        handedOut,
        notHandedOut,
        entryHostToAdd: notHandedOut === 'host-not-picked' ? (pickable?.id ?? null) : null,
        policiesToOffer: world.policies
          .filter((p) => offered.has(p.id))
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((p) => ({ id: p.id, name: p.name })),
        nodePolicyNote: nodePolicyNoteOf(acl !== undefined, c, shape, world),
      };
    });
}

/**
 * Narrow or widen a cascade's directions in `exitAcl`, the way the server
 * reads it: no entry = every direction; a list = only those (by direction id,
 * or by node on a legacy hop cascade: `field`).
 *
 *   - a direction of a cascade with no entry is switched off by writing every
 *     OTHER direction;
 *   - switching a direction back on adds it; when that makes every direction
 *     allowed, the entry goes (the unrestricted form, not a full list);
 *   - the last allowed direction cannot be taken off: an empty list means the
 *     whole cascade is off, and that is the switch's job (null = refused, the
 *     caller says why);
 *   - a cascade that is off keeps its exits as they are: narrowing happens
 *     inside a cascade that is on.
 */
export function toggleCascadeExit(
  acl: SquadExitAclEntry[],
  cascadeId: string,
  field: AclField,
  exits: Pick<SquadCascadeExit, 'aclIds' | 'allowed'>[],
  target: Pick<SquadCascadeExit, 'aclIds' | 'allowed'>,
): SquadExitAclEntry[] | null {
  const all = [...new Set(exits.flatMap((e) => e.aclIds))];
  const current = acl.find((e) => e.cascadeId === cascadeId);
  if (current && aclIdsOf(current).length === 0) return acl;
  const allowed = new Set(current ? aclIdsOf(current) : all);
  if (target.allowed) target.aclIds.forEach((id) => allowed.delete(id));
  else target.aclIds.forEach((id) => allowed.add(id));
  if (allowed.size === 0) return null;
  const rest = acl.filter((e) => e.cascadeId !== cascadeId);
  if (all.every((id) => allowed.has(id))) return rest;
  return [...rest, { cascadeId, [field]: all.filter((id) => allowed.has(id)) }];
}

/**
 * Switch a cascade on or off for a squad: one `exitAcl` entry per cascade,
 * the server refuses two (400 «One exitAcl entry per cascade»).
 *
 *   - off writes an empty list in place of whatever was there, and hands back
 *     the narrowed list it replaced as `parked`, so the form can put it back;
 *   - on drops the entry (every exit), or returns the parked list when there
 *     is one. The parked list is read against today's exits: ids that left
 *     the cascade are dropped, and a list that covers every exit, or none, is
 *     no narrowing at all.
 *
 * Asking for the state the cascade is already in changes nothing.
 */
export function setCascadeOn(
  acl: SquadExitAclEntry[],
  cascadeId: string,
  on: boolean,
  field: AclField,
  allIds: string[],
  parked?: string[],
): { acl: SquadExitAclEntry[]; parked?: string[] } {
  const current = acl.find((e) => e.cascadeId === cascadeId);
  const isOff = current !== undefined && aclIdsOf(current).length === 0;
  const rest = acl.filter((e) => e.cascadeId !== cascadeId);
  if (!on) {
    if (isOff) return { acl, parked };
    return { acl: [...rest, { cascadeId, [field]: [] }], parked: current ? aclIdsOf(current) : undefined };
  }
  if (!isOff) return { acl };
  const all = new Set(allIds);
  const back = [...new Set(parked ?? [])].filter((id) => all.has(id));
  if (back.length === 0 || back.length === all.size) return { acl: rest };
  return { acl: [...rest, { cascadeId, [field]: back }] };
}

/**
 * What a squad's `exitAcl` says, for the squad list: every exit, or how many
 * cascades it switches off and how many it narrows. Entries of cascades that
 * are gone say nothing and are not counted.
 */
export function squadExitsSummary(
  acl: SquadExitAclEntry[],
  cascadeIds: ReadonlySet<string>,
): { off: number; narrowed: number } | 'all' {
  const known = acl.filter((e) => cascadeIds.has(e.cascadeId));
  if (known.length === 0) return 'all';
  const off = known.filter((e) => aclIdsOf(e).length === 0).length;
  return { off, narrowed: known.length - off };
}

/**
 * 400 EXIT_ACL_INVALID (39c266a): an entry names a direction the cascade does
 * not have (deleted while the form was open), or a node under none. The
 * server's sentence, for the screen. Input checked first.
 */
export function exitAclInvalid(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const res = (err as { response?: unknown }).response;
  if (typeof res !== 'object' || res === null) return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 400 || typeof data !== 'object' || data === null) return null;
  const { error, message } = data as { error?: unknown; message?: unknown };
  if (error !== 'EXIT_ACL_INVALID') return null;
  return typeof message === 'string' ? message : '';
}

/** Is this the 400 the server gives for two exitAcl entries of one cascade.
 *  The screen writes one entry per cascade and should never see it. */
export function isDuplicateExitAcl(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const res = (err as { response?: unknown }).response;
  if (typeof res !== 'object' || res === null) return false;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 400) return false;
  return JSON.stringify(data ?? '').includes('One exitAcl entry per cascade');
}
