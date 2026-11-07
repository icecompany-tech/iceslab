import { Link } from 'react-router-dom'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { directionVia, isOneLegCascade, legCellNotes, legFacts, legParamFacts, legPortNotes, legUnderlay, LEG_PORT_BASE, withUnderlay, type CellGap, type LegUnderlay, type LinkPortConflict, type UnderlayChoice } from '@/contours/cascades/lib/cascadeForm'
import { useDict } from '@/lib/i18n'
import type { LinkCell, LinkCongestion, LinkParams, LinkUnderlay } from '@/lib/old/cascades'
import { DEFAULT_LINK_UNDERLAY } from '@/lib/old/cascades'
import { linkCellOptions } from '@/lib/old/engines'
import { linkCellEngines, nodeCarriesCell } from '@/lib/old/linkCells'
import { Field } from '@/ui/Field/Field'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

function UnderlayRow({ underlay }: { underlay: LegUnderlay }) {
  const words = useDict(DICT)
  const { facts, refused, place, choice, onChange } = underlay
  const blocked = facts.missing.length > 0
  const named = (u: LinkUnderlay) => (u === 'awg' ? words.underlayAwg : words.underlayDirect)
  const reason = facts.missing[0] ? words.underlayMissing(facts.missing[0].name) : undefined
  return (
    <>
      <Segmented<UnderlayChoice>
        label={words.underlayLabel}
        value={choice}
        onChange={onChange}
        options={[
          ...(place === 'direction' ? [{ value: 'inherit' as const, label: words.underlayInherit(named(facts.value)) }] : []),
          { value: 'direct' as const, label: words.underlayDirect },
          { value: 'awg' as const, label: words.underlayAwg, ...(blocked && facts.value !== 'awg' && reason ? { disabledReason: reason } : {}) },
        ]}
      />
      {place === 'one-leg' && <p className={styles.note}>{words.underlayOneLeg}</p>}
      {facts.value === 'awg' && <p className={styles.note}>{words.underlayAwgHint}</p>}
      {facts.missing.map((n) => (
        <p key={n.id} className={styles.danger}>
          {words.underlayMissing(n.name)} <Link className={styles.link} to={`/nodes/${n.id}`}>{words.underlayInstall}</Link>
        </p>
      ))}
      {facts.silent.length > 0 && <p className={styles.note}>{words.underlaySilent(facts.silent.join(', '))}</p>}
      {refused.length > 0 && <p className={styles.danger}>{words.underlayRefused(refused.join(', '))}</p>}
    </>
  )
}

interface Leg {
  title: string
  portWord: string
  cell: string | null
  params: LinkParams | null
  caption?: string
  locked?: boolean
  placeholder?: string
  underlay?: LegUnderlay
  gaps: readonly CellGap[]
  ports: readonly LinkPortConflict[]
  onCell: (value: string) => void
  onParams: (next: LinkParams) => void
}

function LegRow({ leg }: { leg: Leg }) {
  const words = useDict(DICT)
  const param = legParamFacts(leg.cell)
  const options = linkCellOptions(leg.cell, (_key, opts) => words.cellUnrealised(String(opts?.name ?? '')))
  return (
    <div className={styles.hopRow}>
      <div className={styles.hopHead}>
        <b>{leg.title}</b>
        <span className={styles.note}>{leg.portWord}</span>
      </div>
      {leg.caption && <p className={styles.note}>{leg.caption}</p>}
      <Field label={words.cellLabel}>{(a11y) => <Select {...a11y} disabled={leg.locked} value={leg.cell ?? ''} onChange={(e) => leg.onCell(e.target.value)} options={leg.placeholder === undefined ? options : [{ value: '', label: leg.placeholder }, ...options]} />}</Field>
      {param.kind === 'minted' && <p className={styles.note}>{words.legObfsMinted}</p>}
      {param.kind === 'congestion' && (
        <Field label={words.legCongestion}>{(a11y) => <Select {...a11y} value={leg.params?.congestion ?? ''} onChange={(e) => leg.onParams({ congestion: e.target.value as LinkCongestion })} options={[{ value: '', label: words.legCongestionDefault(param.fallback ?? '') }, ...param.options.map((o) => ({ value: o, label: o }))]} />}</Field>
      )}
      {leg.underlay && <UnderlayRow underlay={leg.underlay} />}
      {leg.gaps.map((g) => (
        <p key={g.nodeId} className={styles.danger}>
          {words.legNodeGap(g.name, leg.cell ?? '', g.engines.length > 0 ? g.engines.join(', ') : words.legNodeNoEngines)}
        </p>
      ))}
      {leg.ports.map((c) => (
        <p key={`${c.nodeName}-${c.port}`} className={styles.danger}>
          {words.legPortTaken(c.port, c.transport, c.nodeName, c.profileName)}
        </p>
      ))}
    </div>
  )
}

export function LinkStep({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { pools, directions } = form.draft
  const oneLeg = isOneLegCascade(pools.length, directions.length)
  const cellRefusals = form.refusal?.kind === 'cells' ? form.refusal.cells : []
  const portConflicts = form.refusal?.kind === 'ports' ? form.refusal.ports : []
  const underlayRefused = form.refusal?.kind === 'underlay' ? form.refusal.names : []
  const nodeMap = new Map(form.nodeById)
  const last = pools[pools.length - 1]
  const names = (ids: readonly string[], fallback: string) => ids.filter(Boolean).map((id) => form.nodeName(id)).join(', ') || fallback
  return (
    <>
      {pools.map((pool, i) => {
        const next = pools[i + 1]
        // The last position's leg is the default of every direction without its own.
        const receivers = next?.nodeIds ?? directions.flatMap((d) => d.nodeIds)
        const facts = legFacts(pool.linkProtocol, i, linkCellEngines)
        return (
          <LegRow
            key={pool.key}
            leg={{
              title: words.legOf(names(pool.nodeIds, words.pendingEntry), next ? names(next.nodeIds, words.pendingTransit) : words.flowExit),
              portWord: words.legPort(facts.port),
              cell: pool.linkProtocol,
              params: pool.linkParams ?? null,
              ...(next ? {} : { caption: words.legToDirections }),
              ...(oneLeg ? {} : { underlay: legUnderlay([...pool.nodeIds, ...receivers], form.nodeById, pool.linkParams?.underlay, undefined, underlayRefused, (u) => form.setPool(i, { linkParams: withUnderlay(pool.linkParams, u), linkTouched: true })) }),
              gaps: legCellNotes(next?.nodeIds ?? [], pool.linkProtocol, nodeMap, nodeCarriesCell, cellRefusals),
              ports: legPortNotes(next?.nodeIds ?? [], LEG_PORT_BASE + i, nodeMap, portConflicts),
              onCell: (value) => form.setPool(i, { linkProtocol: value }),
              onParams: (patch) => form.setPool(i, { linkParams: { ...(pool.linkParams ?? {}), ...patch }, linkTouched: true }),
            }}
          />
        )
      })}
      {directions.map((d, i) => {
        if (directionVia(d) !== 'pool') return null
        const cell = d.linkProtocol ?? null
        return (
          <LegRow
            key={d.key}
            leg={{
              title: words.legOf(names(last?.nodeIds ?? [], words.pendingEntry), names(d.nodeIds, d.countryCode || words.directionNoNodes)),
              portWord: d.linkPort === null || d.linkPort === undefined ? words.legPortServer : words.legPort(d.linkPort),
              cell,
              params: d.linkParams ?? null,
              placeholder: words.legFromEntry,
              ...(form.legCellKnown ? {} : { locked: true, caption: words.legNotReported }),
              underlay: legUnderlay([...(last?.nodeIds ?? []), ...d.nodeIds], form.nodeById, d.linkParams?.underlay, last?.linkParams?.underlay ?? DEFAULT_LINK_UNDERLAY, underlayRefused, (u) => form.setDirection(i, { linkParams: withUnderlay(d.linkParams, u), linkTouched: true }), oneLeg ? 'one-leg' : 'direction'),
              gaps: legCellNotes(d.nodeIds, d.linkProtocol, nodeMap, nodeCarriesCell, cellRefusals),
              ports: legPortNotes(d.nodeIds, d.linkPort, nodeMap, portConflicts),
              onCell: (value) => form.setDirection(i, { linkProtocol: (value || null) as LinkCell | null, linkTouched: true }),
              onParams: (patch) => form.setDirection(i, { linkParams: { ...(d.linkParams ?? {}), ...patch }, linkTouched: true }),
            }}
          />
        )
      })}
    </>
  )
}
