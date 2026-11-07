import type { Cascade } from '@/lib/old/cascades';

/**
 * Which cascade a node stands in, and as what: one answer for the whole panel
 * (A-139, A-144).
 *
 * A v4 cascade that does not fold into hops (a pooled entry, a transit with
 * several directions, a direction on a named outbound) answers with
 * `hops: []`, and every reader that went by hops saw its nodes as standing
 * alone: the cascade form said nothing about a taken node, the node list
 * filed it under «single», the node page said its traffic leaves directly.
 * Positions and directions first; hops only for a cascade stored the old way.
 *
 * A-101 (BACK 7c5e3ed7): a node carries one ENABLED cascade. A save that
 * would put it in a second one is refused 409 NODE_IN_OTHER_CASCADE, and a
 * pair stored before the rule is held by the OLDEST enabled cascade
 * (createdAt, then id), which is also the order GET /api/cascades answers in.
 * So only enabled cascades count here, in the server's order, never re-sorted:
 * the first one that names the node holds it, and the «in cascade X» note at
 * pick time names the cascade the server would refuse over. A switched-off
 * cascade holds nothing: it is not drawn on the node.
 */
export type CascadeRole = 'entry' | 'transit' | 'exit';

type Shape = Pick<Cascade, 'id' | 'name' | 'mode' | 'enabled' | 'hops' | 'positions' | 'directions'>;

/** Every node of one cascade with its role, in path order, each node once. */
export function cascadeMembers(c: Shape): { nodeId: string; role: CascadeRole }[] {
  const out: { nodeId: string; role: CascadeRole }[] = [];
  const seen = new Set<string>();
  const add = (nodeId: string, role: CascadeRole) => {
    if (!nodeId || seen.has(nodeId)) return;
    seen.add(nodeId);
    out.push({ nodeId, role });
  };
  if (c.positions.length > 0 || c.directions.length > 0) {
    for (const p of [...c.positions].sort((a, b) => a.position - b.position)) {
      for (const id of p.nodeIds) add(id, p.position === 0 ? 'entry' : 'transit');
    }
    for (const d of c.directions) for (const id of d.nodeIds) add(id, 'exit');
    return out;
  }
  const hops = [...c.hops].sort((a, b) => a.position - b.position);
  const last = hops.length - 1;
  hops.forEach((h, i) =>
    add(h.nodeId, i === 0 ? 'entry' : c.mode === 'balancer' || i === last ? 'exit' : 'transit'),
  );
  return out;
}

/** Node id to its cascade and role. `exceptId` leaves out the cascade being edited. */
export function cascadeMemberships<C extends Shape>(
  cascades: readonly C[],
  exceptId?: string,
): Map<string, { cascade: C; role: CascadeRole }> {
  const m = new Map<string, { cascade: C; role: CascadeRole }>();
  for (const c of cascades) {
    if (c.id === exceptId || !c.enabled) continue;
    for (const { nodeId, role } of cascadeMembers(c)) if (!m.has(nodeId)) m.set(nodeId, { cascade: c, role });
  }
  return m;
}

/** Node id to the name of the cascade holding it: the «in cascade X» note at pick time. */
export function cascadeClaims(cascades: readonly Shape[], exceptId?: string): Map<string, string> {
  return new Map([...cascadeMemberships(cascades, exceptId)].map(([id, m]) => [id, m.cascade.name]));
}

/** The entry nodes of a cascade: where a client's bytes come in. */
export function cascadeEntryNodeIds(c: Shape): string[] {
  return cascadeMembers(c)
    .filter((m) => m.role === 'entry')
    .map((m) => m.nodeId);
}

/**
 * The ways out of a cascade as words: a direction's country, else its first
 * node's country, else its tag; for the old hop cascade, the exit nodes'
 * countries. `countryOf` gives a node's country code: `null` when the node
 * has none, `undefined` when the node is not known (the fleet list did not
 * arrive). An old-cascade exit with no country is left out, as before; one
 * whose node is not known stays as `?`, because dropping it read as «this
 * node feeds fewer exits» (spec frontend-nodes, P5).
 */
export function cascadeExitWords(c: Shape, countryOf: (nodeId: string) => string | null | undefined): string[] {
  if (c.positions.length > 0 || c.directions.length > 0) {
    return c.directions.map((d) => {
      const code = d.countryCode || (d.nodeIds[0] ? countryOf(d.nodeIds[0]) : null);
      return code ? code.toUpperCase() : `#${d.tag}`;
    });
  }
  return cascadeMembers(c)
    .filter((m) => m.role === 'exit')
    .map((m) => countryOf(m.nodeId))
    .filter((code): code is string | undefined => code !== null && code !== '')
    .map((code) => (code === undefined ? '?' : code.toUpperCase()));
}
