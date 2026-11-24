import type { ReactNode } from 'react'
import { useTrafficSeries, type SeriesPeriod } from '@/contours/overview/hooks/useTrafficSeries'
import { DICT } from '@/contours/overview/dict'
import { changePercent } from '@/contours/overview/lib/traffic'
import { fmtBytes, fmtBytesLarge, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { OverviewChart } from './DailyChart'
import { TrafficHeader } from './TrafficHeader'
import styles from './blocks.module.css'

export function MeasuredTraffic({ period, controls }: { period: SeriesPeriod; controls: ReactNode }) {
  const query = useTrafficSeries(period)
  const words = useDict(DICT)
  const { locale } = useLocale()
  const header = { title: words.trafficFor[period], controls }
  if (!query.data || query.isError) {
    const unavailable = isApiError(query.error) && query.error.status === 404
    return <section className={styles.block}>
      <TrafficHeader {...header} />
      {query.isError
        ? <QueryFailedLine onRetry={() => void query.refetch()} retryLabel={words.retry}>
            {unavailable ? words.seriesUnsupported : failureText(query.error, locale)}
          </QueryFailedLine>
        : <QueryLoading label={words.seriesLoading} />}
    </section>
  }
  const { points, canCompareTotals } = query.data
  const current = points.flatMap(p => p.bytes === null ? [] : [p.bytes])
  const prior = points.flatMap(p => p.previousBytes === null ? [] : [p.previousBytes])
  if (current.length === 0 && prior.length === 0) {
    return <section className={styles.block}>
      <TrafficHeader {...header} />
      <div className={styles.chartNote}>{words.seriesEmpty} {period === '1h' && words.minuteClock}</div>
    </section>
  }
  const sum = current.reduce((n, v) => n + v, 0)
  const previous = prior.reduce((n, v) => n + v, 0)
  const change = canCompareTotals && current.length ? changePercent(sum, previous) : null
  const minute = period === '1h'
  const time = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short',
    ...(minute ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { year: 'numeric' }) })
  const partial = !canCompareTotals || current.length < points.length || prior.length < points.length
  return <section className={styles.block}>
    <TrafficHeader {...header} value={current.length ? fmtBytesLarge(sum, locale) : words.noData}
      current={current.length ? words.seriesCurrent[period] : undefined}
      previous={prior.length ? words.seriesPrior[period] : undefined}
      summary={<>
        {partial && words.partialTotal}
        {!canCompareTotals && <span> · {words.coverage}</span>}
        {change !== null && <span>{change > 0 ? '+' : ''}{fmtPercent(change, locale, 1)} · {words.seriesPrior[period]} ({fmtBytes(previous, locale)})</span>}
        {!partial && change === null && words.noPrevData}
      </>} />
    <OverviewChart key={period} points={points} period={period} />
    <div className={styles.strip}>
      <div className={styles.cell}><div className={styles.cellLabel}>{minute ? words.averageMinute : words.averageDay}</div>
        <div className={styles.cellValue}>{current.length ? fmtBytes(sum / current.length, locale) : words.noData}</div></div>
      <div className={styles.cell}><div className={styles.cellLabel}>{words.recordedCount}</div>
        <div className={styles.cellValue}>{current.length} / {points.length}</div></div>
      <div className={styles.cell}><div className={styles.cellLabel}>{words.periodDates} (UTC)</div>
        <div className={styles.cellValue}>{time.formatRange(new Date(points[0]!.date), new Date(points.at(-1)!.date))}</div></div>
    </div>
    {minute && <div className={styles.note}>{words.minuteClock}</div>}
  </section>
}
