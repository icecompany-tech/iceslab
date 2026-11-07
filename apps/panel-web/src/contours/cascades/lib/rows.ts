import type { DICT } from '@/contours/cascades/dict'
import { draftOfCascade } from '@/contours/cascades/lib/draft'
import { buildFlow, pathLine } from '@/contours/cascades/lib/flow'
import { cascadeShape } from '@/contours/cascades/lib/shape'
import { cascadeMembers } from '@/lib/old/cascadeMembership'
import { cascadeReach } from '@/lib/old/cascadePath'
import { cascadeStatusView, type CascadeStatusView } from '@/lib/old/cascadeStatus'
import type { Cascade, CascadeStatus } from '@/lib/old/cascades'
import type { NamedOutbound } from '@/lib/old/namedOutbounds'
import type { Node } from '@/lib/old/nodes'

export interface RowSources {
  nodeById: ReadonlyMap<string, Node>
  outboundById: ReadonlyMap<string, NamedOutbound> | null
  statusOf: (id: string) => CascadeStatus | undefined
  todayOf: (nodeId: string) => number | null | undefined
  bindings: Parameters<typeof cascadeReach>[1]
  squads: Parameters<typeof cascadeReach>[2]
  policies: Parameters<typeof cascadeReach>[3]
}

export type CascadeRow = ReturnType<typeof cascadeRow>

/** Everything a card or a list row says about a cascade, assembled once: both densities read the same numbers. */
export function cascadeRow(cascade: Cascade, src: RowSources, words: typeof DICT.ru) {
  const draft = draftOfCascade(cascade, src.nodeById, true)
  const status = cascade.enabled ? src.statusOf(cascade.id) : undefined
  const flow = buildFlow({ pools: draft.pools, directions: draft.directions, enabled: cascade.enabled, autoProfile: cascade.autoProfile, nodeById: src.nodeById, outboundById: src.outboundById, ...(status ? { hops: status.hops } : {}) }, words)
  const shape = cascadeShape(cascade)
  const known = shape.entryNodeIds.map(src.todayOf).filter((v): v is number => typeof v === 'number')
  const push: CascadeStatusView = cascade.enabled ? cascadeStatusView(status) : { kind: 'loading' }
  return {
    cascade,
    shape,
    flow,
    path: pathLine(flow.columns),
    hops: draft.pools.length + 1,
    reach: cascadeReach(shape.entryNodeIds, src.bindings, src.squads, src.policies),
    today: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
    push,
    nodeNames: cascadeMembers(cascade).flatMap((m) => {
      const node = src.nodeById.get(m.nodeId)
      return node ? [{ id: node.id, name: node.name }] : []
    }),
  }
}
