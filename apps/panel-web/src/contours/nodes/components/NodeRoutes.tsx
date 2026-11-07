import { useMemo, useState } from 'react'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCascades, useNodeBindings, useNodePolicies, useOldSquads, usePolicyDrawing, useRoutePolicies } from '@/contours/nodes/hooks/useNodes'
import { policyDrawingLoad } from '@/contours/nodes/lib/policyDrawing'
import { nodePolicyBand, routeRows, type PolicyBand, type RouteRow } from '@/contours/nodes/lib/routeRows'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeExitWords, cascadeMemberships } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import type { RoutePolicy } from '@/lib/old/routePolicies'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'

function Row({ match, action, why, tone }: { match: string; action: string; why: string; tone?: 'muted' | 'amber' }) {
  return (
    <tr className={tone === 'amber' ? styles.routeDead : ''}>
      <td>{match}</td>
      <td>{action}</td>
      <td className={tone === 'amber' ? styles.amber : styles.muted}>{why}</td>
    </tr>
  )
}

/** Read only: the rows in the order the agent draws them, top to bottom (routeRows). */
export function NodeRoutes({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const cascades = useCascades()
  const policies = useNodePolicies()
  const bindings = useNodeBindings(node.id)
  const squads = useOldSquads()
  const routePolicies = useRoutePolicies()
  const drawingQuery = usePolicyDrawing(node.id, Boolean(node.policyId))
  const [tag, setTag] = useState(0)
  const say = (err: unknown) => failureText(err, locale)
  const member = cascadeMemberships(cascades.data?.cascades ?? []).get(node.id)
  const isBalancerEntry = member?.role === 'entry' && member.cascade.mode === 'balancer'
  const reachable = useMemo(() => {
    if (!isBalancerEntry) return []
    const bound = new Set((bindings.data?.bindings ?? []).map((b) => b.profileId))
    const bySource = new Map<string, { policy: RoutePolicy; squads: string[] }>()
    for (const squad of squads.data?.squads ?? []) {
      if (!squad.profileIds.some((id) => bound.has(id))) continue
      for (const id of squad.policyIds) {
        const policy = routePolicies.data?.policies.find((p) => p.id === id)
        if (!policy) continue
        const row = bySource.get(id) ?? { policy, squads: [] }
        row.squads.push(squad.name)
        bySource.set(id, row)
      }
    }
    return [...bySource.values()].sort((a, b) => a.policy.ordinal - b.policy.ordinal)
  }, [isBalancerEntry, bindings.data, squads.data, routePolicies.data])

  if (cascades.isError) {
    return (
      <QueryFailedLine retryLabel={words.retry} onRetry={() => void cascades.refetch()}>
        {say(cascades.error)}
      </QueryFailedLine>
    )
  }
  const load = policyDrawingLoad(drawingQuery, say)
  const nodePolicy = nodePolicyBand(node.policyId, policies, load.kind === 'ready' ? load.drawing : null, say)
  const active = isBalancerEntry ? (reachable.find((p) => p.policy.ordinal === tag) ?? null) : null
  const rows = routeRows({ role: member?.role ?? null, isBalancerEntry, squadPolicy: active, nodePolicy })
  const exits = member ? cascadeExitWords(member.cascade, () => null) : []
  const where = exits.length > 0 ? exits.join(' · ') : '-'
  const policyName = nodePolicy.band.kind === 'ready' ? nodePolicy.band.name : ''
  const egress = node.warpEnabled ? words.egressWarp : words.egressDirect
  const cascadeName = member?.cascade.name ?? ''

  const bandText = (band: PolicyBand) => {
    switch (band.kind) {
      case 'none':
        return words.bandNone
      case 'loading':
        return words.bandLoading
      case 'missing':
        return words.bandMissing
      case 'ready':
        return band.drawingKnown ? words.bandReady(band.name) : `${words.bandReady(band.name)} · ${words.bandUnknownDrawing}`
      case 'failed':
        return `${words.bandFailed}: ${band.message}`
    }
  }

  const row = (r: RouteRow, i: number) => {
    switch (r.kind) {
      case 'quic':
        return <Row key={i} match={words.quicMatch} action={words.quicAction} why={words.quicWhy} />
      case 'squadBlock':
        return <Row key={i} match={r.domains.join(' · ')} action={words.toNowhere} why={words.source(r.source.policy, r.source.squads.join(', '))} />
      case 'squadDirect':
        return <Row key={i} match={r.domains.join(' · ')} action={words.fromOurIp} why={words.source(r.source.policy, r.source.squads.join(', '))} />
      case 'squadDead':
        return <Row key={i} tone="amber" match={r.domains.join(' · ')} action={words.fromOurIp} why={words.deadWhy} />
      case 'policyBand':
        return (
          <tr key={i} className={styles.routeBand}>
            <td colSpan={3}>{bandText(r.band)}</td>
          </tr>
        )
      case 'policyRule': {
        const action = r.rule.action === 'cascade' ? words.policyCascade(r.rule.direction ?? '-') : (words.policyAction[r.rule.action] ?? r.rule.action)
        const match = r.rule.match.length > 0 ? r.rule.match.join(' · ') : words.policyAny
        if (r.rule.notDrawn) return <Row key={i} tone="amber" match={match} action={action} why={r.rule.notDrawnReason === 'nobody-may-take' ? words.policyNobody : words.policyNotDrawn(policyName)} />
        return <Row key={i} match={match} action={action} why={r.rule.ungated ? `${words.policyWhy(policyName)}. ${words.policyUngated}` : words.policyWhy(policyName)} tone={r.rule.ungated ? 'amber' : undefined} />
      }
      case 'fromLink':
        return <Row key={i} match={words.fromLink} action={r.role === 'exit' ? words.fromOurIp : words.toDirection(where)} why={words.fromLinkWhy(cascadeName)} />
      case 'catchAll':
        switch (r.to) {
          case 'nothing':
            return <Row key={i} match={words.everythingElse} action={words.nothingElse} why={words.nothingElseWhy} />
          case 'egress':
            return <Row key={i} match={words.everythingElse} action={egress} why={words.defaultWhy} />
          case 'direction':
            return <Row key={i} match={words.everythingElse} action={words.toDirection(where)} why={words.fromLinkWhy(cascadeName)} />
          case 'exits':
            return <Row key={i} match={words.everythingElse} action={exits.length === 1 ? words.exitOne(exits[0] ?? '') : words.exitMany(exits.length)} why={words.defaultWhy} />
        }
    }
  }

  return (
    <section className={styles.panel}>
      {isBalancerEntry && (
        <div className={styles.routesFor}>
          <Select look="filter" aria-label={words.routesFor} value={String(tag)} onChange={(e) => setTag(Number(e.target.value))} options={[{ value: '0', label: words.routesPlain }, ...reachable.map(({ policy }) => ({ value: String(policy.ordinal), label: policy.name }))]} />
        </div>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{words.routeMatch}</th>
            <th scope="col">{words.routeAction}</th>
            <th scope="col">{words.routeWhy}</th>
          </tr>
        </thead>
        <tbody>{rows.map(row)}</tbody>
      </table>
    </section>
  )
}
