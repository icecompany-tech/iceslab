import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { byAttention, certTone } from '@/contours/overview/lib/traffic'
import { useNow } from '@/lib/clock'
import { certDaysLeft, nodeEngines, useAllNodes, type NodeRow } from '@/lib/domain/nodes'
import { nodeHealth, type NodeHealth, type Overview, type OverviewNode } from '@/lib/domain/overview'
import { fmtBytes, fmtDuration } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Chip } from '@/ui/Chip/Chip'
import { CoreChips } from '@/ui/CoreChip/CoreChip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { Meter } from '@/ui/Meter/Meter'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'

const SHOWN = 5

type Filter = 'all' | 'problem' | 'unverified'

interface Row extends OverviewNode {
  health: NodeHealth
  detail: NodeRow | undefined
}

function NodeLine({ row, maxBytes }: { row: Row; maxBytes: number }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const engines = row.detail ? nodeEngines(row.detail) : null
  const days = certDaysLeft(row.detail?.certNotAfter, now())
  const reason = words.statusWord[row.status]
  const ago = row.lastStatusChange ? fmtDuration((now() - Date.parse(row.lastStatusChange)) / 1000, locale) : null
  const off = row.health === 'unverified' || row.health === 'off'
  return (
    <div role="row" className={`${styles.row} ${row.health === 'problem' ? styles.rowProblem : ''}`}>
      <span role="cell" className={styles.stateCell}>
        <span className={`${styles.nodeDot} ${row.health === 'problem' ? styles.dotBad : off ? styles.dotUnknown : styles.dotPlain}`} />
      </span>
      <span role="cell" className={styles.nodeCell}>
        <span className={styles.nodeName}>
          <Flag code={row.countryCode} />
          <span className={styles.name}>{row.name}</span>
        </span>
        {row.health === 'problem' ? (
          <span className={styles.nodeProblem}>
            <Icon name="warn" size="sm" />
            {ago ? words.since(reason ?? row.status, ago) : (reason ?? row.status)}
          </span>
        ) : (
          <span className={styles.note}>{row.health === 'ok' ? row.address : (reason ?? row.address)}</span>
        )}
      </span>
      <span role="cell" className={styles.enginesCell}>
        {engines && <CoreChips engines={engines} tone={row.health === 'problem' ? 'danger' : 'accent'} />}
      </span>
      <span role="cell" className={styles.usersCell} title={words.usersUnknown}>
        ?
      </span>
      {off ? (
        <span role="cell" className={`${styles.trafficCell} ${styles.noData}`}>
          {words.noData}
        </span>
      ) : (
        <span role="cell" className={styles.trafficCell}>
          <span className={styles.trafficValue}>{fmtBytes(row.todayBytes, locale)}</span>
          <Meter size="table" percent={(row.todayBytes / maxBytes) * 100} />
        </span>
      )}
      <CertCell days={days} />
    </div>
  )
}

function CertCell({ days }: { days: number | null }) {
  const words = useDict(DICT)
  if (days === null) {
    return (
      <span role="cell" className={`${styles.certCell} ${styles.noData}`}>
        {words.noData}
      </span>
    )
  }
  const tone = certTone(days)
  return (
    <span role="cell" className={`${styles.certCell} ${tone === 'expired' ? styles.certExpired : tone === 'soon' ? styles.certSoon : ''}`}>
      {tone === 'expired' ? words.expired : words.days(days)}
    </span>
  )
}

export function NodesBlock({ nodes }: { nodes: Overview['nodes'] }) {
  const words = useDict(DICT)
  const details = useAllNodes()
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState(false)
  const byId = new Map((details.data ?? []).map((n) => [n.id, n]))
  const rows: Row[] = byAttention(nodes.map((n) => ({ ...n, health: nodeHealth(n.status), detail: byId.get(n.id) })))
  const count = (health: NodeHealth) => rows.filter((r) => r.health === health).length
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.health === filter)
  const shown = expanded ? filtered : filtered.slice(0, SHOWN)
  const maxBytes = Math.max(...rows.map((r) => r.todayBytes), 1)
  const pick = (next: Filter) => {
    setFilter(next)
    setExpanded(false)
  }
  return (
    <section className={styles.block}>
      <div className={styles.nodesHead}>
        <div className={styles.chips}>
          <h2 className={styles.heading}>
            <Icon name="nodes" size="lg" />
            {words.nodes}
          </h2>
          <Chip label={words.all} count={rows.length} active={filter === 'all'} onClick={() => pick('all')} />
          <Chip label={words.problems} count={count('problem')} dot="danger" active={filter === 'problem'} onClick={() => pick('problem')} />
          <Chip label={words.unverified} count={count('unverified')} dot="unknown" active={filter === 'unverified'} onClick={() => pick('unverified')} />
        </div>
        <Link className={styles.allNodes} to="/nodes">
          {words.allNodes}
          <Icon name="arrowRight" size="md" />
        </Link>
      </div>
      {details.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void details.refetch()}>
          {words.nodesDetailFailed}
        </QueryFailedLine>
      )}
      <div role="table" aria-label={words.nodes} className={styles.table}>
        <div role="row" className={styles.tableHead}>
          <span role="columnheader" className={styles.stateCell} />
          <span role="columnheader" className={styles.nodeCell}>
            {words.node}
          </span>
          <span role="columnheader" className={styles.enginesCell}>
            {words.engines}
          </span>
          <span role="columnheader" className={styles.usersCell}>
            {words.usersColumn}
          </span>
          <span role="columnheader" className={styles.trafficHead2}>
            {words.traffic24}
          </span>
          <span role="columnheader" className={styles.certCell}>
            {words.cert}
          </span>
        </div>
        {shown.length === 0 ? (
          <div className={styles.empty}>{rows.length === 0 ? words.emptyNodes : words.emptyFilter}</div>
        ) : (
          shown.map((row) => <NodeLine key={row.id} row={row} maxBytes={maxBytes} />)
        )}
        {shown.length > 0 && (
          <div className={styles.tableFoot}>
            <span>{shown.length === filtered.length ? words.shownAll(shown.length) : words.shown(shown.length, filtered.length)}</span>
            {shown.length < filtered.length && (
              <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
                {words.more(filtered.length - shown.length)}
                <Icon name="chevronDown" size="sm" />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
