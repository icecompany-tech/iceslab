import { isNight, isWeekend } from '@/contours/overview/lib/chart'
import { Button } from '@/ui/Button/Button'
import { OverviewState } from './OverviewState'
import { OverviewChart } from './DailyChart'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isSeriesPeriod, type TrafficPeriod } from '@/contours/overview/hooks/useTrafficSeries'
import { TrafficHeader } from './TrafficHeader'
import { MeasuredTraffic } from './MeasuredTraffic'
import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { changePercent, hourlyPoints } from '@/contours/overview/lib/traffic'
import type { Overview } from '@/lib/domain/overview'
import { fmtBytes, fmtBytesLarge, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { Segmented } from '@/ui/Segmented/Segmented'

const periods: TrafficPeriod[] = ['1h', '24h', '7d', '30d', '90d']

export function TrafficBlock({ traffic, checkedAt, onRetry, retrying }: { checkedAt: number; traffic: Overview['traffic']; onRetry: () => void; retrying: boolean }) {
  const words = useDict(DICT)
  const [search, setSearch] = useSearchParams()
  const requested = search.get('period')
  const period = isSeriesPeriod(requested) || requested === '24h' ? requested
    : traffic?.completedUtc30d?.dailyComparison?.length === 30 ? '30d' : '24h'
  const controls = <Segmented label={words.windowLabel} value={period}
    options={periods.map(value => ({ value, label: words.window[value] }))}
    onChange={value => {
      const next = new URLSearchParams(search)
      next.set('period', value)
      setSearch(next, { replace: true, preventScrollReset: true })
    }} />
  if (period === '30d' && traffic?.completedUtc30d?.dailyComparison?.length !== 30) {
    const directions = traffic?.completedUtc30d?.monthlyDirections
    return <MeasuredTraffic period={period} controls={controls} fallback={traffic
      ? notice => <TrafficData window="30d" traffic={traffic} checkedAt={checkedAt} controls={controls} notice={notice} />
      : undefined}>
      {directions && <>
        <div className={styles.note}>{words.clientMonth}</div>
        <div className={styles.strip}><DirectionCells values={directions} /></div>
      </>}
    </MeasuredTraffic>
  }
  if (period !== '30d' && isSeriesPeriod(period)) return <MeasuredTraffic period={period} controls={controls} />
  const empty = traffic && !traffic.completedUtc30d && !traffic.recordedUtc24h?.length && traffic.last24hHourly.length === 0 && [traffic.todayBytes, traffic.last7dBytes, traffic.last30dBytes, traffic.prev30dBytes, traffic.currentYearBytes].every(n => n === 0)
  if (traffic && !empty) return <TrafficData traffic={traffic} checkedAt={checkedAt} window={period} controls={controls} />
  return <section className={styles.block}>
    <TrafficHeader title={words.trafficFor[period]} controls={controls} />
    {empty ? <OverviewState kind="traffic" title={words.trafficEmpty} body={words.trafficEmptyBody} />
      : <OverviewState kind="error" title={words.trafficFailed} body={words.trafficFailureBody}>
          <Button loading={retrying} onClick={onRetry}>{words.retry}</Button>
        </OverviewState>}
  </section>
}

function DirectionCells({ values }: { values: { toUsers: number; fromUsers: number } }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const total = values.toUsers + values.fromUsers
  return ([['down', values.toUsers], ['up', values.fromUsers]] as const).map(([key, bytes]) =>
    <div className={styles.cell} key={key}><div className={styles.cellLabel}>{words[key]}</div>
      <div className={styles.cellValue}>{fmtBytesLarge(bytes, locale)} <span className={styles.cellNote}>{total > 0 && fmtPercent(100 * bytes / total, locale)}</span></div></div>)
}

function TrafficData({ traffic, checkedAt, window, controls, notice }: {
  checkedAt: number; traffic: NonNullable<Overview['traffic']>; window: '24h' | '30d'; controls: ReactNode; notice?: ReactNode
}) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const confirmed = traffic.completedUtc30d
  const days = confirmed?.dailyComparison?.length === 30 ? confirmed.dailyComparison : []
  const hourly = window === '24h'
  const recorded = traffic.recordedUtc24h?.length === 24 ? traffic.recordedUtc24h : undefined
  const directions = hourly ? (recorded ? undefined : traffic.hourlyDirections) : confirmed?.monthlyDirections
  const directionTotal = directions ? directions.toUsers + directions.fromUsers : 0
  const month = days.length ? days.reduce((n, d) => n + d.bytes, 0) : directions ? directionTotal : traffic.last30dBytes
  const priorMonth = days.length ? days.reduce((n, d) => n + d.previousBytes, 0) : directions ? null : traffic.prev30dBytes

  const hours = recorded ? recorded.map(h => ({ ...h, date: h.hour })) : hourlyPoints(traffic.last24hHourly, checkedAt)
  const measured = hours.filter(h => h.bytes !== null)
  const total = hourly ? measured.reduce((n, h) => n + (h.bytes ?? 0), 0) : month
  const previousDay = measured.length === 24 && hours.every(h => h.previousBytes != null) ? hours.reduce((n, h) => n + (h.previousBytes ?? 0), 0) : null
  const previous = hourly ? previousDay : priorMonth
  const summaryOnly = window === '30d' && !days.length && !directions
  const change = previous === null ? null : changePercent(total, previous)
  const sign = change !== null && change > 0 ? '+' : ''
  const series = hourly ? measured : days
  const shaded = hourly ? isNight : isWeekend
  const average = (rows: typeof series) => rows.reduce((n, p) => n + (p.bytes ?? 0), 0) / rows.length
  const shade = series.filter(p => shaded(p.date))
  const plain = series.filter(p => !shaded(p.date))
  const relative = shade.length && plain.length ? changePercent(average(shade), average(plain)) : null
  const duration = hourly ? 24 : 30
  const mean = hourly ? (measured.length ? average(measured) : null) : total / duration
  const oldMean = previous === null ? null : previous / duration
  const hasPrevious = hourly ? hours.some(h => h.previousBytes != null) : days.length > 0
  return (
    <section className={styles.block}>
      <TrafficHeader title={words.trafficFor[window]} controls={controls}
        value={hourly && !measured.length ? words.noData : fmtBytesLarge(total, locale)}
        current={series.length ? (hourly ? words.currentHours : words.currentLine) : undefined}
        previous={hasPrevious ? (hourly ? words.yesterday : words.previousLine) : undefined}
        summary={summaryOnly ? words.unequalWindows
          : previous === null ? (hourly ? (recorded ? words.recordedOnly : words.noCompareDay) : words.noCompareMonth)
          : change === null ? words.noPrevData : <>
            <Icon name={change >= 0 ? 'trendUp' : 'trendDown'} size="md" />
            <span className={styles.compareValue}>{sign}{fmtPercent(change, locale, 1)}</span>
            {words.againstPrev[window](fmtBytesLarge(previous, locale))}
          </>} />
      {!hourly && (days.length > 0 || directions) && <div className={styles.note}>{words.clientMonth}</div>}
      {window === '30d' && days.length > 0 ? (
        <OverviewChart key="days" points={days} period="30d" />
      ) : window !== '24h' ? (
        <div className={styles.chartNote}>{notice ?? words.noSeries}</div>
      ) : !recorded && traffic.last24hHourly.length === 0 ? (
        <div className={styles.chartNote}>{words.noTraffic}</div>
      ) : (
        <OverviewChart key="hours" points={hours} period="24h" />
      )}
      <div className={styles.strip}>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{summaryOnly ? words.priorTotal : hourly ? words.averageHour : words.averageDay}</div>
          <div className={styles.cellValue}>
            {summaryOnly && previous !== null ? fmtBytesLarge(previous, locale) : mean === null ? words.noData : fmtBytes(mean, locale)} {!summaryOnly && oldMean !== null && <span className={styles.cellNote}>{words.was(fmtBytes(oldMean, locale))}</span>}
          </div>
        </div>
        {relative !== null ?
          <div className={styles.cell}><div className={styles.cellLabel}>{hourly ? words.nightVsDay : words.weekend}<Icon name="info" size="md" /></div><div className={styles.cellValue}>{relative > 0 ? '+' : ''}{fmtPercent(relative,locale)}</div></div> : <div className={styles.cell}><div className={styles.cellLabel}>{words.today}</div><div className={styles.cellValue}>{fmtBytes(traffic.todayBytes,locale)}</div></div>}
        {directions ? <DirectionCells values={directions} /> : <>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.thisMonth}</div>
          <div className={styles.cellValue}>{fmtBytes(traffic.calendarMonthBytes, locale)}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.thisYear}</div>
          <div className={styles.cellValue}>{fmtBytes(traffic.currentYearBytes, locale)}</div>
        </div>
        </>}
      </div>
    </section>
  )
}
