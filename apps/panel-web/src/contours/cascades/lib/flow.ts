import { directionVia, legFacts, LEG_PORT_BASE, type DirectionDraft, type PositionDraft } from '@/contours/cascades/lib/cascadeForm'
import type { DICT } from '@/contours/cascades/dict'
import { nodeHealth } from '@/lib/domain/overview'
import { hopBroken } from '@/lib/old/cascadeStatus'
import type { CascadeHopStatus } from '@/lib/old/cascades'
import { legCellName } from '@/lib/old/engines'
import { linkCellEngines } from '@/lib/old/linkCells'
import { outboundAddress, type NamedOutbound } from '@/lib/old/namedOutbounds'
import type { Node } from '@/lib/old/nodes'
import type { FlowColumn, FlowLink, FlowNode } from '@/ui/CascadeFlow/CascadeFlow'

type Words = typeof DICT.ru

export interface FlowInput {
  pools: readonly PositionDraft[]
  directions: readonly DirectionDraft[]
  enabled: boolean
  autoProfile: boolean
  nodeById: ReadonlyMap<string, Pick<Node, 'name' | 'status'>>
  /** Null: the list did not arrive, so a missing name is unknown, not gone. */
  outboundById: ReadonlyMap<string, NamedOutbound> | null
  hops?: readonly CascadeHopStatus[]
}

const AUTO_ENTRIES: readonly string[] = ['hysteria', 'amneziawg']

/** F-V6: a refusal of the core and a node that did not answer stay two different sentences. */
function pointOf(id: string, input: FlowInput, inBalancer: boolean, words: Words): FlowNode {
  const node = input.nodeById.get(id)
  if (!node) return { key: id, name: words.nodeGone(id.slice(0, 8)), dot: 'failed' }
  if (!input.enabled) return { key: id, name: node.name, dot: 'off' }
  const hop = input.hops?.find((h) => h.nodeId === id)
  const health = nodeHealth(node.status)
  // A node that does not answer has refused nothing: "fetch failed" is a lost link, not the core's word.
  if (health === 'problem' || hop?.online === false) return { key: id, name: node.name, dot: 'down', note: inBalancer ? words.balancerSkips : words.noAnswer }
  const broken = hop ? hopBroken(hop) : null
  if (broken) return { key: id, name: node.name, dot: 'failed', note: words.coreRefused(broken) }
  if (health === 'ok') return { key: id, name: node.name, dot: 'ok' }
  return { key: id, name: node.name, dot: 'unknown', note: words.unverified }
}

const empty = (key: string, name: string): FlowNode => ({ key, name, dot: 'empty' })

function outboundPoint(d: DirectionDraft, input: FlowInput, words: Words): FlowNode {
  const key = `${d.key}-out`
  if (!d.outboundId) return empty(key, words.outboundPick)
  if (!input.outboundById) return { key, name: words.outboundUnknown, dot: 'unknown' }
  const o = input.outboundById.get(d.outboundId)
  return o ? { key, name: o.name, dot: 'ring', note: outboundAddress(o) } : { key, name: words.outboundGone, dot: 'failed' }
}

function poolColumn(pool: PositionDraft, i: number, input: FlowInput, words: Words): FlowColumn {
  const ids = pool.nodeIds.filter(Boolean)
  const isEntry = i === 0
  const balanced = !isEntry && ids.length > 1
  return {
    key: `p${pool.key}`,
    title: isEntry ? words.flowEntry(pool.entryProtocol) : words.flowTransit(i),
    ...(isEntry && ids.length > 1 ? { caption: words.entryClientPicks } : {}),
    groups: [
      {
        key: 'pool',
        ...(balanced ? { balancer: words.balancer } : {}),
        nodes: ids.length > 0 ? ids.map((id) => pointOf(id, input, balanced, words)) : [empty('empty', isEntry ? words.pendingEntry : words.pendingTransit)],
      },
    ],
  }
}

function exitColumn(input: FlowInput, words: Words): FlowColumn {
  const many = input.directions.length > 1
  const entryProtocol = input.pools[0]?.entryProtocol ?? ''
  const auto = input.autoProfile && many
  const caption = AUTO_ENTRIES.includes(entryProtocol) ? words.exitAutoPolicy : auto ? words.exitClientOrAuto : many ? words.exitClientPicks : undefined
  return {
    key: 'exit',
    title: words.flowExit,
    ...(caption ? { caption } : {}),
    ...(auto ? { diamond: true } : {}),
    groups: input.directions.map((d, i) => {
      const onOutbound = directionVia(d) === 'outbound'
      const ids = d.nodeIds.filter(Boolean)
      const balanced = !onOutbound && ids.length > 1
      return {
        key: `d${d.key}`,
        code: d.countryCode || null,
        title: d.tag === null ? words.flowDirectionNew : words.tagOf(d.tag),
        ...(balanced ? { balancer: words.balancer } : {}),
        nodes: onOutbound ? [outboundPoint(d, input, words)] : ids.length > 0 ? ids.map((id) => pointOf(id, input, balanced, words)) : [empty(`e${i}`, words.directionNoNodes)],
      }
    }),
  }
}

function legWords(cell: string | null | undefined, step: number, underlay: string | undefined, words: Words): { over: string; danger: boolean } {
  const facts = legFacts(cell, step, linkCellEngines)
  const name = facts.state === 'known' && facts.cell ? legCellName(facts.cell) : facts.state === 'unrealised' ? words.cellUnrealised(facts.cell ?? '') : words.legUnknown
  return { over: underlay === 'awg' ? words.legInAwg(name) : name, danger: facts.state === 'unrealised' }
}

function links(input: FlowInput, words: Words): FlowLink[] {
  const out: FlowLink[] = []
  input.pools.forEach((pool, i) => {
    const next = input.pools[i + 1]
    const isLast = next === undefined
    const receivers = isLast ? input.directions.flatMap((d) => (directionVia(d) === 'pool' ? d.nodeIds.filter(Boolean) : d.outboundId ? [d.outboundId] : [])) : next.nodeIds.filter(Boolean)
    const pending = receivers.length === 0 || !pool.nodeIds.some(Boolean)
    if (!isLast) {
      const leg = legWords(pool.linkProtocol, i, pool.linkParams?.underlay, words)
      out.push({ key: `l${pool.key}`, over: leg.over, under: words.legPort(LEG_PORT_BASE + i), ...(leg.danger ? { tone: 'danger' as const } : pending ? { tone: 'pending' as const } : {}) })
      return
    }
    const onPools = input.directions.filter((d) => directionVia(d) === 'pool')
    const cells = new Set(onPools.map((d) => d.linkProtocol ?? pool.linkProtocol))
    const underlays = new Set(onPools.map((d) => d.linkParams?.underlay ?? pool.linkParams?.underlay))
    const first = onPools[0]
    const leg = legWords(first?.linkProtocol ?? pool.linkProtocol, i, first?.linkParams?.underlay ?? pool.linkParams?.underlay, words)
    const over = onPools.length === 0 ? words.flowChain : cells.size > 1 || underlays.size > 1 ? words.flowLegsDiffer : leg.over
    const port = first?.linkPort ?? LEG_PORT_BASE + i
    out.push({ key: `l${pool.key}`, over, under: onPools.length === 0 ? '' : words.legPort(port), ...(leg.danger ? { tone: 'danger' as const } : pending ? { tone: 'pending' as const } : {}) })
  })
  return out
}

export function buildFlow(input: FlowInput, words: Words): { columns: FlowColumn[]; links: FlowLink[]; legend?: string } {
  const columns = [...input.pools.map((p, i) => poolColumn(p, i, input, words)), exitColumn(input, words)]
  const anyBalancer = columns.some((c) => c.diamond === true || c.groups.some((g) => g.balancer !== undefined))
  return { columns, links: links(input, words), ...(anyBalancer ? { legend: words.balancerLegend } : {}) }
}

/** The path as one line, for the list. */
export function pathLine(columns: readonly FlowColumn[]): string {
  return columns.map((c) => c.groups.map((g) => (g.title && g.code ? g.code : g.nodes.map((n) => n.name).join(', '))).join(', ')).join(' → ')
}
