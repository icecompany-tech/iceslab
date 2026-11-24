import { useEffect, useRef, useState } from 'react'
import { useNow } from '@/lib/clock'
import { fmtBytes, fmtNumber, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import type { TrafficPeriod } from '@/contours/overview/hooks/useTrafficSeries'
import { DICT } from '@/contours/overview/dict'
import { chartGeometry, isNight, isWeekend, type ChartPoint } from '@/contours/overview/lib/chart'
import styles from './blocks.module.css'

const height = 268

export function OverviewChart({ points, period }: { points: ChartPoint[]; period: TrafficPeriod }) {
  const daily = period.endsWith('d')
  const minute = period === '1h'
  const week = period === '7d'
  const { locale } = useLocale()
  const now = useNow()
  const words = useDict(DICT)
  const [at, setAt] = useState<number | null>(null)
  const plot = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1088)
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(Math.max(160, el.clientWidth)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { left, right, top, bottom, dx, unit, ceiling, x, y, paths } = chartGeometry(points, width, week || period === '24h')
  const current = paths('bytes')
  const previous = paths('previousBytes').line
  const last = points.at(-1)
  const ends = { bytes: points.findLast(p => p.bytes != null), previousBytes: points.findLast(p => p.previousBytes != null) }
  const stamp = new Intl.DateTimeFormat(locale, daily
    ? { timeZone: 'UTC', day: 'numeric', month: 'short' }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: minute ? 'UTC' : undefined })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const shortDate = (date: string) => stamp.format(new Date(date)).replace(/([а-яё]{3})[а-яё]*[.]?$/i, '$1')
  const unitLabel = fmtBytes(unit, locale).split(' ')[1]
  const volume = (v: number) => fmtNumber(v / unit, locale, 1) + ' ' + unitLabel
  const point = at === null ? undefined : points[at]
  const diff = point?.bytes != null && point.previousBytes != null ? point.bytes - point.previousBytes : null
  const sign = diff == null || diff === 0 ? '' : diff > 0 ? '+' : '-'
  const pick = (i: number) => setAt(Math.min(points.length - 1, Math.max(0, i)))
  const values = points.flatMap(p => p.bytes == null ? [] : [p.bytes])
  const lo = Math.min(...values), hi = Math.max(...values)
  const min = points.findIndex(p => p.bytes === lo), max = points.findIndex(p => p.bytes === hi)
  const tickEvery = { '1h': 10, '24h': 3, '7d': 1, '30d': 7, '90d': 14 }[period]
  const major = (i: number) => i % tickEvery === 0
  const shaded = daily ? isWeekend : isNight
  const bands = []
  for (let i = 0; i < points.length; i++) {
    if (minute || !shaded(points[i]!.date)) continue
    const start = Math.max(left, x(i) - dx / 2)
    while (i + 1 < points.length && shaded(points[i + 1]!.date)) i++
    const end = Math.min(right, x(i) + dx / 2)
    bands.push(<g key={start}>
      <rect x={start} y={top} width={end - start} height={bottom - top} fill="var(--color-weekend)" />
      {!daily && end - start >= 40 && <text className={styles.night} x={(start + end) / 2} y={top + 14} textAnchor="middle">{words.night}</text>}
    </g>)
  }
  const calendar = (date: Date) => date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const dayName = (date: Date) => {
    const today = new Date(now())
    if (date.toDateString() === today.toDateString()) return words.today
    today.setDate(today.getDate() - 1)
    return date.toDateString() === today.toDateString() ? words.yesterday : calendar(date)
  }
  const dayMs = 86_400_000
  const previousDate = point && new Date(Date.parse(point.date) - ({ '1h': 3_600_000, '24h': dayMs, '7d': 7 * dayMs, '30d': 30 * dayMs, '90d': 90 * dayMs }[period]))
  const previousLabel = period === '30d' ? words.previousDay
    : period === '24h' && previousDate ? dayName(previousDate) + words.atTime + stamp.format(previousDate)
    : previousDate && period !== '24h' ? words.seriesPrior[period] + ' · ' + stamp.format(previousDate) : ''
  const fullDate = point && (daily
    ? weekday.format(new Date(point.date))
    : minute ? new Date(point.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : dayName(new Date(point.date))) + ', ' + shortDate(point.date)
  return <div ref={plot} className={styles.daily} aria-describedby={point ? 'overview-traffic-tooltip' : undefined}
    role="group" aria-label={words.trafficFor[period]} tabIndex={0}
    onFocus={() => setAt(0)} onBlur={() => setAt(null)}
    onKeyDown={e => {
      if (e.key === 'Escape') setAt(null)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        pick((at ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))
      }
    }}
    onMouseMove={e => pick(Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left - left) / dx))}
    onMouseLeave={() => setAt(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs><linearGradient id="overview-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-area-top)" /><stop offset="1" stopColor="var(--color-area-bottom)" />
      </linearGradient></defs>
      {bands}
      {[0, 1, 2, 3, 4].map(n => <g key={n}>
        <line x1={left} x2={right} y1={y(n * ceiling / 4)} y2={y(n * ceiling / 4)} stroke="var(--color-border)" strokeDasharray={n ? '2 4' : undefined} />
        <text x={left - 10} y={y(n * ceiling / 4) + 4} textAnchor="end">{n ? fmtBytes(n * ceiling / 4, locale) : '0'}</text>
      </g>)}
      {points.map((p, i) => <g key={p.date}>
        <path d={`M${x(i)} ${bottom}v${major(i) ? 6 : 3}`} stroke={major(i) ? 'var(--color-chart-tick)' : 'var(--color-border)'} />
        {period === '24h' && i > 0 && new Date(p.date).toDateString() !== new Date(points[i - 1]!.date).toDateString() &&
          <text x={x(i)} y={bottom + 38} textAnchor="middle">{calendar(new Date(p.date))}</text>}
        {week && <text x={x(i)} y={bottom + 37} textAnchor="middle">{weekday.format(new Date(p.date))}</text>}
        {major(i) && <text className={week ? styles.weekDate : undefined} x={x(i)} y={bottom + 22} textAnchor="middle">{shortDate(p.date)}</text>}
      </g>)}
      <path d={current.area} fill="url(#overview-fill)" />
      {previous && <path d={previous} className={styles.priorLine} />}
      <path d={current.line} className={styles.currentLine} />
      {points.map((p, i) => p.bytes != null && (week
        ? <circle key={p.date} cx={x(i)} cy={y(p.bytes)} r="3.5" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="1.5" />
        : i !== at && i !== max && i !== min && <circle key={p.date} cx={x(i)} cy={y(p.bytes)} r="1.6" fill="var(--color-accent)" />))}
      {points.map((p, i) => p.previousBytes != null && points[i - 1]?.previousBytes == null && points[i + 1]?.previousBytes == null &&
        <circle key={p.date} cx={x(i)} cy={y(p.previousBytes)} r={period === '24h' ? 1.6 : 3} fill="var(--color-amber)" />)}
      {[max, min].map((i, order) => {
        const p = points[i]
        if (p?.bytes == null || (order === 1 && min === max)) return null
        const labelX = Math.max(left + 10, Math.min(right - 10, x(i)))
        const anchor = labelX - left < 54 ? 'start' : right - labelX < 54 ? 'end' : 'middle'
        let labelY = order ? y(p.bytes) + 17 : y(p.bytes) - 12
        if (order && p.previousBytes != null && Math.abs(y(p.previousBytes) - labelY) < 12) {
          labelY = y(p.previousBytes) + 17
        }
        return <g key={order}>
          {!week && <circle cx={x(i)} cy={y(p.bytes)} r="3.5" fill="var(--color-bg)" stroke={order ? 'var(--color-text-muted)' : 'var(--color-accent)'} strokeWidth="1.5" />}
          <text className={order ? undefined : styles.peak} x={labelX} y={Math.max(12, Math.min(bottom + 4, labelY))}
            textAnchor={anchor}>
            {order ? words.min : words.max} {fmtNumber(p.bytes / unit, locale, 1)}{daily ? ', ' : words.atTime}{shortDate(p.date)}
          </text>
        </g>
      })}
      {(['bytes', 'previousBytes'] as const).map((key, i) => {
        const end = ends[key]
        const value = end?.[key]
        if (value == null) return null
        const other = i ? ends.bytes?.bytes : ends.previousBytes?.previousBytes
        const above = other != null && (value > other || value === other && !i)
        let pos = y(value)
        if (other != null) {
          const offset = Math.max(14 - Math.abs(y(other) - pos) / 2, daily ? 14 : 0)
          pos += above ? -offset : offset
        }
        const minY = other != null && !above ? 40 : 12
        const maxY = other != null && above ? bottom - 22 : bottom + 6
        pos = Math.max(minY, Math.min(maxY, pos))
        return <g key={key} className={i ? styles.previousEndLabel : styles.endLabel}>
          {end !== last && <title>{shortDate(end!.date)}</title>}
          <rect x={right + 10.5} y={pos - 11.5} width="69" height="23" rx="11.5" />
          <text x={right + 45} y={pos + 4} textAnchor="middle">{!daily && unit > 1 && value >= unit
            ? (value / unit).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ' + unitLabel
            : fmtBytes(value, locale)}</text>
        </g>
      })}
      {point && at !== null && <g className={styles.cursor}>
        <line x1={x(at)} x2={x(at)} y1={top} y2={bottom} />
        {(['bytes', 'previousBytes'] as const).map(key => {
          const value = point[key]
          if (value == null) return null
          return <circle key={key} cx={x(at)} cy={y(value)} r={key === 'bytes' ? 4.5 : 4} data-previous={key === 'previousBytes' || undefined} />
        })}
      </g>}
    </svg>
    {point && at !== null && <div className={styles.dailyTip} role="tooltip" id="overview-traffic-tooltip" ref={el => {
      if (!el) return
      const marker = x(at)
      const beside = marker + 14 + el.offsetWidth <= right ? marker + 14 : marker - el.offsetWidth - 14
      const leftEdge = Math.max(0, Math.floor(beside))
      const anchor = y(point.bytes ?? point.previousBytes ?? 0)
      let topEdge = daily ? Math.min(height - el.offsetHeight, anchor + 45) : Math.max(0, anchor - el.offsetHeight - 5)
      const peak = period === '24h' && plot.current?.querySelector<SVGTextElement>('text.' + styles.peak)?.getBBox()
      if (peak && leftEdge < peak.x + peak.width && leftEdge + el.offsetWidth > peak.x
        && topEdge < peak.y + peak.height && topEdge + el.offsetHeight > peak.y) {
        topEdge = Math.min(height - el.offsetHeight, anchor + 18)
      }
      el.style.left = leftEdge + 'px'
      el.style.top = Math.round(topEdge) + 'px'
    }}>
      <strong>{fullDate}{(!daily || isWeekend(point.date)) && <small> · {daily ? words.weekendDay : minute ? words.perMinute : words.perHour}</small>}</strong>
      <span className={styles.currentTip}>{daily ? words.thisDay : minute ? words.minute : words.thisHour}<b>{point.bytes == null ? words.noData : fmtBytes(point.bytes, locale)}</b></span>
      {point.previousBytes != null && <span className={styles.previousTip}>{previousLabel}<b>{fmtBytes(point.previousBytes, locale)}</b></span>}
      {diff !== null && point.previousBytes != null && <span className={styles.tipDifference} data-positive={diff > 0 || undefined}>{words.difference}<b>{sign}{volume(Math.abs(diff))}{point.previousBytes > 0 && ' · ' + sign + fmtPercent(Math.abs(diff) * 100 / point.previousBytes, locale, 1)}</b></span>}
    </div>}
  </div>
}
