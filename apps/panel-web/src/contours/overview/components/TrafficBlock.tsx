import { isNight, isWeekend } from '@/contours/overview/lib/chart'
import { Button } from '@/ui/Button/Button'
import { OverviewState } from './OverviewState'
import { OverviewChart } from './DailyChart'
import { useState } from 'react'
import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { changePercent, hourlyPoints } from '@/contours/overview/lib/traffic'
import type { Overview } from '@/lib/domain/overview'
import { fmtBytes, fmtBytesLarge, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { Segmented } from '@/ui/Segmented/Segmented'

type Window = '1h' | '24h' | '7d' | '30d' | '90d'

export function TrafficBlock({ traffic, checkedAt, onRetry, retrying }: { checkedAt: number; traffic: Overview['traffic']; onRetry: () => void; retrying: boolean }) {
  const words = useDict(DICT)
  const empty = traffic && !traffic.completedUtc30d && traffic.last24hHourly.every(h => h.bytes === 0) && [traffic.todayBytes, traffic.last7dBytes, traffic.last30dBytes, traffic.prev30dBytes, traffic.currentYearBytes].every(n => n === 0)
  if (traffic && !empty) return <TrafficData traffic={traffic} checkedAt={checkedAt} />
  return <section className={styles.block}>
    <h2 className={styles.heading}><Icon name="traffic" size="lg" />{words.trafficFor['30d']}</h2>
    {empty ? <OverviewState kind="traffic" title={words.trafficEmpty} body={words.trafficEmptyBody} />
      : <OverviewState kind="error" title={words.trafficFailed} body={words.trafficFailureBody}>
          <Button loading={retrying} onClick={onRetry}>{words.retry}</Button>
        </OverviewState>}
  </section>
}

function TrafficData({ traffic, checkedAt }: { checkedAt: number; traffic: NonNullable<Overview['traffic']> }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const confirmed = traffic.completedUtc30d
  const days = confirmed?.dailyComparison?.length === 30 ? confirmed.dailyComparison : []
  const [selected, setSelected] = useState<Window | null>(null)
  const window = selected === '7d' || selected === '30d' ? selected : selected === null && days.length ? '30d' : '24h'
  const hourly = window === '24h'
  const directions = hourly ? traffic.hourlyDirections : window === '30d' ? confirmed?.monthlyDirections : undefined
  const directionTotal = directions ? directions.toUsers + directions.fromUsers : 0
  const month = days.length ? days.reduce((n, d) => n + d.bytes, 0) : window === '30d' && directions ? directionTotal : traffic.last30dBytes
  const priorMonth = days.length ? days.reduce((n, d) => n + d.previousBytes, 0) : window === '30d' && directions ? null : traffic.prev30dBytes

  const hours = hourlyPoints(traffic.last24hHourly, checkedAt)
  const measured = hours.filter(h => h.bytes !== null)
  const total = hourly ? measured.reduce((n, h) => n + (h.bytes ?? 0), 0) : window === '7d' ? traffic.last7dBytes : month
  const previousDay = hours.every(h => h.previousBytes !== undefined) ? hours.reduce((n, h) => n + (h.previousBytes ?? 0), 0) : null
  const previous = hourly ? previousDay : window === '7d' ? traffic.prev7dBytes : priorMonth
  const change = previous === null ? null : changePercent(total, previous)
  const sign = change !== null && change > 0 ? '+' : ''
  const closed = (value: Window, label: string) => ({ value, label, disabledReason: words.noWindow })
  const series = hourly ? measured : window === '30d' ? days : []
  const shaded = hourly ? isNight : isWeekend
  const average = (rows: typeof series) => rows.reduce((n, p) => n + (p.bytes ?? 0), 0) / rows.length
  const shade = series.filter(p => shaded(p.date))
  const plain = series.filter(p => !shaded(p.date))
  const relative = shade.length && plain.length ? changePercent(average(shade), average(plain)) : null
  const mean = hourly ? (measured.length ? average(measured) : null) : month / 30
  const previousForMean = hourly ? previousDay : priorMonth
  const oldMean = previousForMean === null ? null : previousForMean / (hourly ? 24 : 30)
  const hasPrevious = hourly ? hours.some(h => h.previousBytes !== undefined) : window === '30d' && days.length > 0
  return (
    <section className={styles.block}>
      <div className={styles.trafficHead}>
        <div className={styles.trafficSummary}>
          <h2 className={styles.heading}>
            <Icon name="traffic" size="lg" />
            {words.trafficFor[window]}
          </h2>
          <div className={styles.hero}>{fmtBytesLarge(total, locale)}</div>
          {previous === null ? (
            <div className={styles.compare}>{hourly ? words.noCompareDay : words.noCompareMonth}</div>
          ) : change === null ? (
            <div className={styles.compare}>{words.noPrevData}</div>
          ) : (
            <div className={styles.compare}>
              <Icon name={change >= 0 ? 'trendUp' : 'trendDown'} size="md" />
              <span className={styles.compareValue}>
                {sign}
                {fmtPercent(change, locale, 1)}
              </span>
              {words.againstPrev[window](fmtBytesLarge(previous, locale))}
            </div>
          )}
        </div>
        <div className={styles.plotControls}>
          {hasPrevious && <div className={styles.legend}><span>{hourly ? words.currentHours : words.currentLine}</span><span>{hourly ? words.yesterday : words.previousLine}</span></div>}
        <Segmented
          label={words.windowLabel}
          value={window}
          onChange={setSelected}
          options={[
            closed('1h', words.window['1h']),
            { value: '24h', label: words.window['24h'] },
            { value: '7d', label: words.window['7d'] },
            { value: '30d', label: words.window['30d'] },
            closed('90d', words.window['90d']),
          ]}
        />
        </div>
      </div>
      {window === '30d' && days.length > 0 ? (
        <OverviewChart key="days" points={days} monthly />
      ) : window !== '24h' ? (
        <div className={styles.chartNote}>{words.noSeries}</div>
      ) : traffic.last24hHourly.length === 0 ? (
        <div className={styles.chartNote}>{words.noTraffic}</div>
      ) : (
        <OverviewChart key="hours" points={hours} monthly={false} />
      )}
      <div className={styles.strip}>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{hourly ? words.averageHour : words.averageDay}</div>
          <div className={styles.cellValue}>
            {mean === null ? words.noData : fmtBytes(mean, locale)} {oldMean !== null && <span className={styles.cellNote}>{words.was(fmtBytes(oldMean, locale))}</span>}
          </div>
        </div>
        {relative !== null ?
          <div className={styles.cell}><div className={styles.cellLabel}>{hourly ? words.nightVsDay : words.weekend}<Icon name="info" size="md" /></div><div className={styles.cellValue}>{relative > 0 ? '+' : ''}{fmtPercent(relative,locale)}</div></div> : <div className={styles.cell}><div className={styles.cellLabel}>{words.today}</div><div className={styles.cellValue}>{fmtBytes(traffic.todayBytes,locale)}</div></div>}
        {directions ? <>
          {([['down',directions.toUsers],['up',directions.fromUsers]] as const).map(([key,bytes]) =>
            <div className={styles.cell} key={key}><div className={styles.cellLabel}>{words[key]}</div>
              <div className={styles.cellValue}>{fmtBytesLarge(bytes,locale)} <span className={styles.cellNote}>{directionTotal > 0 && fmtPercent(100*bytes/directionTotal,locale)}</span></div></div>)}
        </> : <>
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
