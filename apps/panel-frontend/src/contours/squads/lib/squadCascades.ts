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
 * STATUS IS A FACT, not a switch. A cascade works for a squad exactly when the
 * squad hands out a host on one of its entry nodes: the subscription builder
 * hangs the direction profiles off the entry host, and with no entry host there
 * is no line to carry a tag. `exitAcl` only NARROWS the directions of a cascade
 * (a cascade with no rows gives all of them, and an empty list is not stored),
 * it cannot switch one off; that needs a contract from BACK.
 */

export interface SquadCascadeExit {
  key: string;
  tag: number;
  countryCode: string | null;
  nodeIds: string[];
  nodeNames: string[];
  /** Handed out: every direction when the cascade has no acl rows. */
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
  exits: SquadCascadeExit[];
  /** The cascade has acl rows for this squad: only `allowed` exits go out. */
  exitsNarrowed: boolean;
  handedOut: boolean;
  notHandedOut: NotHandedOut | null;
  /** The entry host «выдать вход» adds to the restriction, when that is the fix. */
  entryHostToAdd: string | null;
  /** Policies granted on this cascade by other squads and not by this one. */
  policiesToOffer: { id: string; name: string }[];
}

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
  nodes: { id: string; name: string; countryCode: string | null }[];
  /** Every squad, for the policies granted on a cascade; the edited one is skipped by id. */
  squads: Pick<Squad, 'id' | 'profileIds' | 'hostIds' | 'policyIds'>[];
  policies: { id: string; name: string; ordinal: number }[];
}

/** Entry node ids and directions of a cascade, v4 first, hops for the old ones. */
export function cascadeShape(c: Pick<Cascade, 'hops' | 'positions' | 'directions'>): {
  entryNodeIds: string[];
  directions: { key: string; tag: number; countryCode: string | null; nodeIds: string[] }[];
} {
  if (c.positions.length > 0) {
    const entry = c.positions.find((p) => p.position === 0);
    return {
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
    entryNodeIds: hops[0] ? [hops[0].nodeId] : [],
    directions: hops.slice(1).map((h, i) => ({ key: h.id, tag: i + 1, countryCode: null, nodeIds: [h.nodeId] })),
  };
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
      const exits = shape.directions.map((d) => ({
        key: d.key,
        tag: d.tag,
        countryCode: d.countryCode ?? nodeById.get(d.nodeIds[0] ?? '')?.countryCode ?? null,
        nodeIds: d.nodeIds,
        nodeNames: d.nodeIds.map((id) => nodeById.get(id)?.name ?? id.slice(0, 8)),
        allowed: acl ? d.nodeIds.some((id) => acl.exitNodeIds.includes(id)) : true,
      }));

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
        exits,
        exitsNarrowed: acl !== undefined,
        handedOut,
        notHandedOut,
        entryHostToAdd: notHandedOut === 'host-not-picked' ? (pickable?.id ?? null) : null,
        policiesToOffer: world.policies
          .filter((p) => offered.has(p.id))
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((p) => ({ id: p.id, name: p.name })),
      };
    });
}

/**
 * Narrow or widen a cascade's directions in `exitAcl`, the way the server
 * reads it: no rows = every direction; rows = only those exit nodes.
 *
 *   - a direction of a cascade with no rows is switched off by writing every
 *     OTHER direction's nodes;
 *   - switching a direction back on adds its nodes; when that makes every
 *     direction allowed, the rows go (the unrestricted form, not a full list);
 *   - the last allowed direction cannot be switched off: an empty list is not
 *     stored and would read as «all» (null = refused, the caller says why).
 */
export function toggleCascadeExit(
  acl: SquadExitAclEntry[],
  cascadeId: string,
  exits: Pick<SquadCascadeExit, 'nodeIds' | 'allowed'>[],
  target: Pick<SquadCascadeExit, 'nodeIds' | 'allowed'>,
): SquadExitAclEntry[] | null {
  const allNodes = [...new Set(exits.flatMap((e) => e.nodeIds))];
  const current = acl.find((e) => e.cascadeId === cascadeId);
  const allowedNodes = new Set(current ? current.exitNodeIds : allNodes);
  if (target.allowed) target.nodeIds.forEach((id) => allowedNodes.delete(id));
  else target.nodeIds.forEach((id) => allowedNodes.add(id));
  if (allowedNodes.size === 0) return null;
  const rest = acl.filter((e) => e.cascadeId !== cascadeId);
  if (allNodes.every((id) => allowedNodes.has(id))) return rest;
  return [...rest, { cascadeId, exitNodeIds: allNodes.filter((id) => allowedNodes.has(id)) }];
}
