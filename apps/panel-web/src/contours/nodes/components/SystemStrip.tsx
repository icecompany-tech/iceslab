import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { nodeHealth, useOverview } from '@/lib/domain/overview'
import { fmtBytes, fmtDuration, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import type { Node } from '@/lib/old/nodes'
import { Flag } from '@/ui/Flag/Flag'
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
  const line = (label: string, percent: number | undefined) => (
    <div className={styles.stripMetric}>
      <span className={styles.metricLabel}>{label}</span>
      {percent === undefined ? '-' : fmtPercent(percent, locale)}
      {percent !== undefined && <Meter size="table" percent={percent} tone={meterTone(percent)} />}
    </div>
  )
  return (
    <section className={styles.strip} aria-label={words.system}>
      <div className={styles.stripTop}>
        <span className={styles.nameCell}>
          <span className={`${styles.dot} ${styles[`dot_${health}`]}`} />
          <Flag code={node.countryCode} />
          <b>{node.name}</b>
          <span className={health === 'problem' ? styles.danger : styles.muted}>{words.statusWord[node.status] ?? node.status}</span>
        </span>
        <span className={styles.stripFacts}>
          <span>
            {words.today}: {live ? fmtBytes(live.todayBytes, locale) : words.metricsUnknown}
          </span>
          <span>
            {words.uptime}: {metrics ? fmtDuration(metrics.uptimeSeconds, locale) : words.metricsUnknown}
          </span>
        </span>
      </div>
      <div className={styles.stripMetrics}>
        {line(words.cpu, metrics?.cpu.usagePercent)}
        {line(words.ram, metrics?.memory.usedPercent)}
        {line(words.disk, metrics?.disk.usedPercent)}
      </div>
    </section>
  )
}
