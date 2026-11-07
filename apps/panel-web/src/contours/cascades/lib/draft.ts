import { directionEmpty, directionVia, entryChainFacts, isKnownProtocol, MAX_LINKS, storedEntryPolicy, type DirectionDraft, type PositionDraft } from '@/contours/cascades/lib/cascadeForm'
import { isRealisedLinkCell } from '@/lib/old/engines'
import type { Cascade, CascadeProtocol } from '@/lib/old/cascades'
import type { Node } from '@/lib/old/nodes'

export interface CascadeDraft {
  name: string
  enabled: boolean
  hideHops: boolean
  autoProfile: boolean
  pools: PositionDraft[]
  directions: DirectionDraft[]
  /** The server's counter: tags are never reused, so it is read and never computed. */
  nextTag: number
  /** Three values as in the answer: absent, the server does not know the field; null, none. */
  entryPolicyId?: string | null
}

/** The cascade as the form holds it; v4 first, a cascade still stored as hops read from them. */
export function draftOfCascade(c: Cascade, nodeById: ReadonlyMap<string, Pick<Node, 'countryCode'>>, entryPolicyKnown: boolean): CascadeDraft {
  let n = 0
  const key = () => n++
  const entryPolicyId = storedEntryPolicy(c.entryPolicy, entryPolicyKnown)
  const base = { name: c.name, enabled: c.enabled, hideHops: c.hideHopsFromSub ?? true, autoProfile: c.autoProfile ?? false, nextTag: c.nextDirectionTag, ...(entryPolicyId === undefined ? {} : { entryPolicyId }) }
  if (c.positions.length > 0 && c.directions.length > 0) {
    return {
      ...base,
      pools: [...c.positions]
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          key: key(),
          nodeIds: p.nodeIds.length > 0 ? [...p.nodeIds] : [''],
          entryProtocol: (p.entryProtocol ?? 'xray') as CascadeProtocol,
          linkProtocol: p.linkProtocol ?? 'xray',
          ...(p.linkParams === undefined ? {} : { linkParams: p.linkParams }),
        })),
      directions: c.directions.map((d) => ({
        key: key(),
        id: d.id,
        countryCode: d.countryCode ?? '',
        nodeIds: d.nodeIds.length > 0 ? [...d.nodeIds] : [''],
        tag: d.tag,
        ...(d.linkProtocol === undefined ? {} : { linkProtocol: d.linkProtocol }),
        ...(d.linkParams === undefined ? {} : { linkParams: d.linkParams }),
        ...(d.linkPort === undefined ? {} : { linkPort: d.linkPort }),
        ...(d.outboundId === undefined ? {} : { outboundId: d.outboundId }),
      })),
    }
  }
  const hops = [...c.hops].sort((a, b) => a.position - b.position)
  const head = hops[0]
  const rest = hops.slice(1)
  const exits = c.mode === 'balancer' ? rest : rest.slice(-1)
  const transits = c.mode === 'balancer' ? [] : rest.slice(0, -1)
  const pool = (h: Cascade['hops'][number]): PositionDraft => ({ key: key(), nodeIds: [h.nodeId], entryProtocol: (h.entryProtocol ?? 'xray') as CascadeProtocol, linkProtocol: h.linkProtocol ?? 'xray' })
  return {
    ...base,
    pools: [...(head ? [pool(head)] : [{ key: key(), nodeIds: [''], entryProtocol: 'xray' as CascadeProtocol, linkProtocol: 'xray' }]), ...transits.map(pool)],
    directions:
      exits.length > 0
        ? exits.map((h, i) => ({ key: key(), id: null, countryCode: nodeById.get(h.nodeId)?.countryCode ?? '', nodeIds: [h.nodeId], tag: i + 1 }))
        : [{ key: key(), id: null, countryCode: '', nodeIds: [''], tag: null }],
  }
}

/** A new cascade: one entry, one way out, both still to be picked. */
export function newDraft(entryPolicyKnown: boolean): CascadeDraft {
  return {
    name: '',
    enabled: true,
    hideHops: true,
    autoProfile: false,
    nextTag: 1,
    pools: [{ key: 0, nodeIds: [''], entryProtocol: 'xray', linkProtocol: 'xray' }],
    directions: [{ key: 1, id: null, countryCode: '', nodeIds: [''], tag: null }],
    ...(entryPolicyKnown ? { entryPolicyId: null } : {}),
  }
}

/** A new direction's number before the server issues it. */
export function nextFreeTag(directions: readonly DirectionDraft[], index: number, nextTag: number): number {
  return nextTag + directions.slice(0, index).filter((d) => d.tag === null).length
}

export function nextFreeKey(rows: readonly { key: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.key), -1) + 1
}

/** As the server counts them: each pair of nodes on adjacent steps is one link. */
export function countLinks(pools: readonly PositionDraft[], directions: readonly DirectionDraft[]): number {
  const size = (ids: readonly string[]) => ids.filter(Boolean).length
  let total = 0
  for (let i = 0; i < pools.length - 1; i += 1) total += size(pools[i]?.nodeIds ?? []) * size(pools[i + 1]?.nodeIds ?? [])
  const last = pools[pools.length - 1]
  if (last) for (const d of directions) total += size(last.nodeIds) * size(directionVia(d) === 'pool' ? d.nodeIds : [])
  return total
}

export function allNodeIds(d: Pick<CascadeDraft, 'pools' | 'directions'>): string[] {
  return [...d.pools.flatMap((p) => p.nodeIds), ...d.directions.flatMap((x) => x.nodeIds)].filter(Boolean)
}

/** A stored protocol the server no longer takes: the cascade runs, but cannot be saved as is. */
export function legacyProtocols(pools: readonly PositionDraft[], nodeName: (id: string) => string): { node: string; values: string[] }[] {
  return pools.flatMap((p, i) => {
    const bad = [...(i === 0 && !isKnownProtocol(p.entryProtocol) ? [p.entryProtocol as string] : []), ...(!isRealisedLinkCell(p.linkProtocol) ? [p.linkProtocol] : [])]
    const first = p.nodeIds.find(Boolean)
    return bad.length > 0 ? [{ node: first ? nodeName(first) : '?', values: bad }] : []
  })
}

export type Blocker =
  | { kind: 'name' }
  | { kind: 'distinct' }
  | { kind: 'entry' }
  | { kind: 'transit' }
  | { kind: 'direction' }
  | { kind: 'links'; links: number }
  | { kind: 'legacy'; node: string; values: string[] }
  | { kind: 'notCarried'; protocol: string }

/** The first thing that keeps the save closed, said beside the button. A direction only needs a country: an empty pool is a state the server can hold, unless it is the only way out of a new cascade. */
export function firstBlocker(d: CascadeDraft, nodeName: (id: string) => string): Blocker | null {
  const ids = allNodeIds(d)
  if (d.name.trim() === '') return { kind: 'name' }
  if (new Set(ids).size !== ids.length) return { kind: 'distinct' }
  if (!(d.pools[0]?.nodeIds.some(Boolean) ?? false)) return { kind: 'entry' }
  if (!d.pools.every((p) => p.nodeIds.some(Boolean))) return { kind: 'transit' }
  if (!d.directions.every((x) => x.countryCode !== '')) return { kind: 'direction' }
  const links = countLinks(d.pools, d.directions)
  if (links > MAX_LINKS) return { kind: 'links', links }
  const legacy = legacyProtocols(d.pools, nodeName)[0]
  if (legacy) return { kind: 'legacy', node: legacy.node, values: legacy.values }
  const chain = entryChainFacts(d.pools[0]?.entryProtocol)
  if (chain && !chain.carried) return { kind: 'notCarried', protocol: chain.protocol }
  return null
}

export type SubscriberRow = { kind: 'awg'; awg31: boolean; unknown: boolean } | { kind: 'auto' } | { kind: 'direction'; where: string; tag: string } | { kind: 'direct'; name: string }

/** What lands in a client: a line per served direction, the Auto line when asked for and there are two to pick from. */
export function subscriberRows(d: CascadeDraft, nodeName: (id: string) => string | undefined, awg: { awg31: boolean | undefined; failed: boolean }): SubscriberRow[] {
  const direct: SubscriberRow[] = d.hideHops
    ? []
    : d.directions
        .flatMap((x) => (directionVia(x) === 'pool' ? x.nodeIds.filter(Boolean) : []))
        .flatMap((id) => {
          const name = nodeName(id)
          return name ? [{ kind: 'direct' as const, name }] : []
        })
  if (d.pools[0]?.entryProtocol === 'amneziawg') return [{ kind: 'awg', awg31: awg.awg31 === true, unknown: awg.failed }, ...direct]
  const served = d.directions.filter((x) => !directionEmpty(x))
  const lines: SubscriberRow[] = d.directions.flatMap((x, i) => (x.countryCode && !directionEmpty(x) ? [{ kind: 'direction' as const, where: x.countryCode, tag: (x.tag ?? nextFreeTag(d.directions, i, d.nextTag)).toString(16).padStart(4, '0') }] : []))
  return [...(d.autoProfile && served.length > 1 ? [{ kind: 'auto' as const }] : []), ...lines, ...direct]
}
