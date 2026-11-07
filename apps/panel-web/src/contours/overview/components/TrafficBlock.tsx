import { useState } from 'react'
import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { changePercent, sumHourly } from '@/contours/overview/lib/traffic'
import type { Overview } from '@/lib/domain/overview'
import { fmtBytes, fmtBytesLarge, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { Segmented } from '@/ui/Segmented/Segmented'
import { TrafficChart } from '@/ui/TrafficChart/TrafficChart'

type Window = '1h' | '24h' | '7d' | '30d' | '90d'

const hourLabel = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

export function TrafficBlock({ traffic }: { traffic: Overview['traffic'] }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [selected, setSelected] = useState<Window>('24h')
  const window = selected === '7d' || selected === '30d' ? selected : '24h'

  const total = window === '24h' ? sumHourly(traffic.last24hHourly) : window === '7d' ? traffic.last7dBytes : traffic.last30dBytes
  const previous = window === '7d' ? traffic.prev7dBytes : window === '30d' ? traffic.prev30dBytes : null
  const change = previous === null ? null : changePercent(total, previous)
  const sign = change !== null && change > 0 ? '+' : ''
  const closed = (value: Window, label: string) => ({ value, label, disabledReason: words.noWindow })

  return (
    <section className={styles.block}>
      <div className={styles.trafficHead}>
        <div className={styles.trafficSummary}>
          <h2 className={styles.heading}>
            <Icon name="traffic" size="lg" />
            {words.trafficFor[window]}
          </h2>
          <div className={styles.hero}>{fmtBytesLarge(total, locale)}</div>
          {window === '24h' || previous === null ? (
            <div className={styles.compare}>{words.noCompareDay}</div>
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
      {window !== '24h' ? (
        <div className={styles.chartNote}>{words.noSeries}</div>
      ) : traffic.last24hHourly.length === 0 ? (
        <div className={styles.chartNote}>{words.noTraffic}</div>
      ) : (
        <TrafficChart
          title={words.trafficFor['24h']}
          points={traffic.last24hHourly.map((h) => ({ label: hourLabel(h.hour, locale), value: h.bytes }))}
          formatValue={(v) => fmtBytes(v, locale)}
        />
      )}
      <div className={styles.strip}>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.averageDay}</div>
          <div className={styles.cellValue}>
            {fmtBytes(traffic.last30dBytes / 30, locale)} <span className={styles.cellNote}>{words.was(fmtBytes(traffic.prev30dBytes / 30, locale))}</span>
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.today}</div>
          <div className={styles.cellValue}>{fmtBytes(traffic.todayBytes, locale)}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.thisMonth}</div>
          <div className={styles.cellValue}>{fmtBytes(traffic.calendarMonthBytes, locale)}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>{words.thisYear}</div>
          <div className={styles.cellValue}>{fmtBytes(traffic.currentYearBytes, locale)}</div>
        </div>
      </div>
    </section>
  )
}
