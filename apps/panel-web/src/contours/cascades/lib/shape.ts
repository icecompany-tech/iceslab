import type { Cascade } from '@/lib/old/cascades'

/** Entry nodes and exit countries of a cascade, v4 first, hops for one stored before the move. */
export function cascadeShape(c: Pick<Cascade, 'hops' | 'positions' | 'directions' | 'mode'>): { entryNodeIds: string[]; exitNodeIds: string[]; countries: string[]; entryProtocol: string | null } {
  if (c.positions.length > 0) {
    const entry = c.positions.find((p) => p.position === 0)
    return {
      entryNodeIds: (entry?.nodeIds ?? []).filter(Boolean),
      exitNodeIds: c.directions.flatMap((d) => d.nodeIds).filter(Boolean),
      countries: c.directions.map((d) => d.countryCode).filter(Boolean),
      entryProtocol: entry?.entryProtocol ?? null,
    }
  }
  const hops = [...c.hops].sort((a, b) => a.position - b.position)
  const head = hops[0]
  const rest = hops.slice(1)
  const exits = c.mode === 'balancer' ? rest : rest.slice(-1)
  return { entryNodeIds: head ? [head.nodeId] : [], exitNodeIds: exits.map((h) => h.nodeId), countries: [], entryProtocol: head?.entryProtocol ?? null }
}
