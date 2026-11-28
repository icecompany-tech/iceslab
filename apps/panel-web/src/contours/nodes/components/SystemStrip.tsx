import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { nodeHealth, useOverview } from '@/lib/domain/overview'
import { fmtBytes, fmtDuration, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import type { Node } from '@/lib/old/nodes'
import { NodeUserCount } from '@/contours/nodes/components/NodeUserCount'
import { Meter } from '@/ui/Meter/Meter'
import { meterTone } from '@/ui/Meter/tone'

/** The System strip across the page (owner 05.11). Numbers the server did not give are a dash. */
export function SystemStrip({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const overview = useOverview()
  const live = overview.data?.nodes.find((n) => n.id === node.id)
  const metrics = live?.metrics ?? null
  const health = nodeHealth(node.status)
  const bytes = (used: number, total: number) => fmtBytes(used, locale) + ' / ' + fmtBytes(total, locale)
  const line = (label: string, percent: number | undefined, fact?: string) => (
    <div className={styles.stripMetric}>
      <div className={styles.metricHead}><span>{label} <small className={styles.muted}>{fact}</small></span><b>{percent === undefined ? '—' : fmtPercent(percent, locale)}</b></div>
      {percent !== undefined && <Meter size="table" percent={percent} tone={meterTone(percent)} />}
    </div>
  )
  return (
    <section className={styles.strip} aria-label={words.system}>
      <div className={styles.stripTop}>
        <span className={styles.nameCell}>
          <b>{words.system}</b>
          <span className={`${styles.dot} ${styles[`dot_${health}`]}`} />
          <span className={health === 'problem' ? styles.danger : styles.muted}>{words.statusWord[node.status] ?? node.status}{metrics && ' · ' + fmtDuration(metrics.uptimeSeconds, locale)}</span>
        </span>
        <span className={styles.stripFacts}>
          <span>
            {words.today}: {live && (health !== 'unverified' || live.todayBytes > 0) ? fmtBytes(live.todayBytes, locale) : words.metricsUnknown}
          </span>
          <span>
            {words.usersColumn}: <NodeUserCount id={node.id} />
          </span>
          <span>{words.unassignedOnline}: {words.metricsUnknown}</span>
        </span>
      </div>
      <div className={styles.stripMetrics}>
        {line(words.cpu, metrics?.cpu.usagePercent, metrics && String(metrics.cpu.cores) || undefined)}
        {line(words.ram, metrics?.memory.usedPercent, metrics ? bytes(metrics.memory.usedBytes, metrics.memory.totalBytes) : undefined)}
        {line(words.disk, metrics?.disk.usedPercent, metrics ? bytes(metrics.disk.usedBytes, metrics.disk.totalBytes) : undefined)}
      </div>
    </section>
  )
}
