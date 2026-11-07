import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { useHealth } from '@/contours/overview/hooks/useOverviewFacts'
import type { Overview } from '@/lib/domain/overview'
import { fmtBinaryParts, fmtDuration, fmtNumber, fmtPercent, fmtTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { Meter } from '@/ui/Meter/Meter'
import { meterTone } from '@/ui/Meter/tone'
import { StatCard } from '@/ui/StatCard/StatCard'

function Part({ label, state }: { label: string; state: string | undefined }) {
  const words = useDict(DICT)
  const tone = state === 'ok' ? styles.dotOk : state === undefined ? styles.dotUnknown : styles.dotBad
  return (
    <span className={styles.part} title={state ?? words.healthUnknown}>
      <span className={`${styles.partDot} ${tone}`} />
      {label}
    </span>
  )
}

export function ServerBlock({ host, checkedAt }: { host: Overview['host']; checkedAt: number }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const health = useHealth()
  if (!host) {
    return (
      <section className={styles.block}>
        <h2 className={styles.heading}>
          <Icon name="server" size="lg" />
          {words.server}
        </h2>
        <div className={styles.chartNote}>{words.noHost}</div>
      </section>
    )
  }
  const { cpu, memory, disk, process } = host
  const cpuPercent = cpu.loadPercent ?? cpu.samplePercent
  const used = fmtBinaryParts(memory.usedBytes, locale)
  const totalMemory = fmtBinaryParts(memory.totalBytes, locale)
  const rss = fmtBinaryParts(process.rssBytes, locale)
  const heap = fmtBinaryParts(process.heapLimitBytes, locale)
  const rssPercent = process.heapLimitBytes > 0 ? (process.rssBytes / process.heapLimitBytes) * 100 : 0
  return (
    <section className={styles.block}>
      <div className={styles.serverHead}>
        <h2 className={styles.heading}>
          <Icon name="server" size="lg" />
          {words.server}
        </h2>
        <span className={styles.note}>
          {words.uptime(fmtDuration(process.uptimeSeconds, locale))} · {words.checkedAt(fmtTime(checkedAt, locale))}
        </span>
      </div>
      <div className={styles.cards}>
        <StatCard label={words.cpu} icon="cpu" size="metric" aside={words.cores(cpu.cores)} value={fmtPercent(cpuPercent, locale)}>
          <Meter percent={cpuPercent} tone={meterTone(cpuPercent)} />
          <div className={styles.fine}>{words.loadAverage(cpu.loadavg.map((v) => fmtNumber(v, 'en', 2)).join(' / '))}</div>
        </StatCard>
        <StatCard label={words.memory} icon="memory" size="metric" aside={fmtPercent(memory.usedPercent, locale)} value={`${used.value} ${used.unit}`} valueNote={words.ofUnit(totalMemory.value, totalMemory.unit)}>
          <Meter percent={memory.usedPercent} tone={meterTone(memory.usedPercent)} />
        </StatCard>
        {disk ? (
          <DiskCard disk={disk} />
        ) : (
          <StatCard label={words.disk} icon="disk" size="metric" value={words.unknown}>
            <div className={styles.fine}>{words.diskUnknown}</div>
          </StatCard>
        )}
        <StatCard label={words.process} icon="pulse" size="metric" aside={fmtPercent(rssPercent, locale)} value={rss.value} valueNote={rss.unit}>
          <Meter percent={rssPercent} tone={meterTone(rssPercent)} />
          <div className={styles.parts}>
            <Part label="Postgres" state={health.data?.db} />
            <Part label="Redis" state={health.data?.redis} />
            <span className={styles.fine}>{words.heapOf(`${heap.value} ${heap.unit}`)}</span>
          </div>
        </StatCard>
      </div>
    </section>
  )
}

function DiskCard({ disk }: { disk: NonNullable<NonNullable<Overview['host']>['disk']> }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const used = fmtBinaryParts(disk.usedBytes, locale)
  const total = fmtBinaryParts(disk.totalBytes, locale)
  return (
    <StatCard label={words.disk} icon="disk" size="metric" aside={fmtPercent(disk.usedPercent, locale)} value={`${used.value} ${used.unit}`} valueNote={words.ofUnit(total.value, total.unit)}>
      <Meter percent={disk.usedPercent} tone={meterTone(disk.usedPercent)} />
    </StatCard>
  )
}
