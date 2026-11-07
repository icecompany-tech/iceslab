import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { certAlarm } from '@/contours/nodes/lib/nodeCert'
import { multiplierBadge } from '@/contours/nodes/lib/nodeLimits'
import { useNow } from '@/lib/clock'
import { nodeHealth, type OverviewNode } from '@/lib/domain/overview'
import { fmtBytes, fmtDuration, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import type { CascadeRole } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import { CoreChips } from '@/ui/CoreChip/CoreChip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { Meter } from '@/ui/Meter/Meter'
import { meterTone } from '@/ui/Meter/tone'

function MetricLine({ label, percent, unknown }: { label: string; percent: number | undefined; unknown: string }) {
  const { locale } = useLocale()
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      {percent === undefined ? (
        <span className={styles.muted}>{unknown}</span>
      ) : (
        <>
          <Meter size="table" percent={percent} tone={meterTone(percent)} />
          <span className={styles.metricValue}>{fmtPercent(percent, locale)}</span>
        </>
      )}
    </div>
  )
}

export function NodeCard({ node, live, membership, onOpen }: { node: Node; live: OverviewNode | undefined; membership?: { cascade: { name: string }; role: CascadeRole }; onOpen: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const health = nodeHealth(node.status)
  const metrics = live?.metrics ?? null
  const alarm = certAlarm(node, now())
  const badge = multiplierBadge(node.consumptionMultiplier)
  const engines = node.engines ?? node.intendedEngines
  return (
    <button type="button" className={`${styles.card} ${health === 'problem' ? styles.cardProblem : ''}`} onClick={onOpen}>
      <span className={styles.cardHead}>
        <span className={`${styles.dot} ${styles[`dot_${health}`]}`} />
        <Flag code={node.countryCode} />
        <b className={styles.cardName}>{node.name}</b>
      </span>
      <span className={styles.cardAddress}>{node.address}</span>
      <span className={styles.cardChips}>
        {engines && engines.length > 0 && <CoreChips engines={engines} tone={health === 'problem' ? 'danger' : 'accent'} />}
        {alarm === 'expired' && <span className={styles.tagDanger}>{words.certExpired}</span>}
        {alarm === 'oldAgent' && <span className={styles.tagAmber}>{words.certOldAgent}</span>}
        {badge?.kind === 'free' && <span className={styles.tag}>{words.free}</span>}
        {badge?.kind === 'times' && <span className={styles.tag}>{words.times(badge.value)}</span>}
      </span>
      {health === 'problem' && (
        <span className={styles.cardReason}>
          <Icon name="warn" size="sm" />
          {words.statusWord[node.status] ?? node.status}
          {node.lastStatusMessage ? `: ${node.lastStatusMessage}` : ''}
        </span>
      )}
      {health === 'unverified' && <span className={styles.muted}>{words.statusWord.unknown}</span>}
      <span className={styles.metrics}>
        <MetricLine label={words.cpu} percent={metrics?.cpu.usagePercent} unknown={words.metricsUnknown} />
        <MetricLine label={words.ram} percent={metrics?.memory.usedPercent} unknown={words.metricsUnknown} />
        <MetricLine label={words.disk} percent={metrics?.disk.usedPercent} unknown={words.metricsUnknown} />
      </span>
      <span className={styles.cardFacts}>
        <span>
          <span className={styles.factLabel}>{words.today}</span>
          {live ? fmtBytes(live.todayBytes, locale) : words.metricsUnknown}
        </span>
        <span>
          <span className={styles.factLabel}>{words.uptime}</span>
          {metrics ? fmtDuration(metrics.uptimeSeconds, locale) : words.metricsUnknown}
        </span>
      </span>
      {membership && (
        <span className={styles.cascadeStrip}>
          <Icon name="routes" size="sm" />
          {membership.cascade.name}, {words.role[membership.role] ?? membership.role}
        </span>
      )}
    </button>
  )
}
