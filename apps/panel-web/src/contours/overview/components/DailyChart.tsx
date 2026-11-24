import { useEffect, useRef, useState } from 'react'
import { fmtBytes, fmtNumber, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { DICT } from '@/contours/overview/dict'
import { chartGeometry, isNight, isWeekend, type ChartPoint } from '@/contours/overview/lib/chart'
import styles from './blocks.module.css'

const height = 268

export function OverviewChart({ points, monthly }: { points: ChartPoint[]; monthly: boolean }) {
  const { locale } = useLocale()
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

  const { left, right, top, bottom, dx, unit, ceiling, x, y, paths } = chartGeometry(points, width)
  const current = paths('bytes')
  const previous = paths('previousBytes').line
  const last = points.at(-1)
  const stamp = new Intl.DateTimeFormat(locale, monthly
    ? { timeZone: 'UTC', day: 'numeric', month: 'short' }
    : { hour: '2-digit', minute: '2-digit', hour12: false })
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
  const major = (i: number) => i % (monthly ? 7 : 3) === 0
  const shaded = monthly ? isWeekend : isNight
  const bands = []
  for (let i = 0; i < points.length; i++) {
    if (!shaded(points[i]!.date)) continue
    const start = Math.max(left, x(i) - dx / 2)
    while (i + 1 < points.length && shaded(points[i + 1]!.date)) i++
    const end = Math.min(right, x(i) + dx / 2)
    bands.push(<g key={start}>
      <rect x={start} y={top} width={end - start} height={bottom - top} fill="var(--color-weekend)" />
      {!monthly && end - start >= 40 && <text className={styles.night} x={(start + end) / 2} y={top + 14} textAnchor="middle">{words.night}</text>}
    </g>)
  }
  const fullDate = point && (monthly
    ? new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(point.date)) + ', ' + shortDate(point.date)
    : (new Date(point.date).toDateString() === new Date(last!.date).toDateString() ? words.today : words.yesterday) + ', ' + shortDate(point.date))
  return <div ref={plot} className={styles.daily} aria-describedby={point ? 'overview-traffic-tooltip' : undefined}
    role="group" aria-label={words.trafficFor[monthly ? '30d' : '24h']} tabIndex={0}
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
        {major(i) && <text x={x(i)} y={bottom + 22} textAnchor="middle">{shortDate(p.date)}</text>}
      </g>)}
      <path d={current.area} fill="url(#overview-fill)" />
      {previous && <path d={previous} className={styles.priorLine} />}
      <path d={current.line} className={styles.currentLine} />
      {points.map((p, i) => p.bytes != null && i !== at && i !== max && i !== min &&
        <circle key={p.date} cx={x(i)} cy={y(p.bytes)} r="1.6" fill="var(--color-accent)" />)}
      {[max, min].map((i, order) => {
        const p = points[i]
        if (p?.bytes == null || (order === 1 && min === max)) return null
        const labelX = Math.max(left + 10, Math.min(right - 10, x(i)))
        return <g key={order}>
          <circle cx={x(i)} cy={y(p.bytes)} r="3.5" fill="var(--color-bg)" stroke={order ? 'var(--color-text-muted)' : 'var(--color-accent)'} strokeWidth="1.5" />
          <text className={order ? undefined : styles.peak} x={labelX} y={order ? Math.min(bottom + 4, y(p.bytes) + 17) : Math.max(12, y(p.bytes) - 12)}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {order ? words.min : words.max} {fmtNumber(p.bytes / unit, locale, 1)}{monthly ? ', ' : words.atTime}{shortDate(p.date)}
          </text>
        </g>
      })}
      {(['bytes', 'previousBytes'] as const).map((key, i) => {
        const value = last?.[key]
        if (value == null) return null
        const other = i ? last?.bytes : last?.previousBytes
        const above = other != null && (value > other || value === other && !i)
        let pos = y(value)
        if (other != null) {
          const offset = Math.max(14 - Math.abs(y(other) - pos) / 2, monthly ? 14 : 0)
          pos += above ? -offset : offset
        }
        pos = Math.max(12, Math.min(bottom + 6, pos))
        return <g key={key} className={i ? styles.previousEndLabel : styles.endLabel}>
          <rect x={right + 10.5} y={pos - 11.5} width="69" height="23" rx="11.5" />
          <text x={right + 45} y={pos + 4} textAnchor="middle">{!monthly && unit > 1 && value >= unit
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
      el.style.left = Math.max(0, Math.floor(beside)) + 'px'
      const anchor = y(point.bytes ?? 0)
      el.style.top = Math.round(monthly ? Math.min(height - el.offsetHeight, anchor + 45) : Math.max(0, anchor - el.offsetHeight - 5)) + 'px'
    }}>
      <strong>{fullDate}{(!monthly || isWeekend(point.date)) && <small> · {monthly ? words.weekendDay : words.perHour}</small>}</strong>
      <span className={styles.currentTip}>{monthly ? words.thisDay : words.thisHour}<b>{point.bytes == null ? words.noData : fmtBytes(point.bytes, locale)}</b></span>
      {point.previousBytes != null && diff !== null && <>
        <span className={styles.previousTip}>{monthly ? words.previousDay : words.yesterday + words.atTime + shortDate(point.date)}<b>{fmtBytes(point.previousBytes, locale)}</b></span>
        <span className={styles.tipDifference} data-positive={diff > 0 || undefined}>{words.difference}<b>{sign}{volume(Math.abs(diff))}{point.previousBytes > 0 && ' · ' + sign + fmtPercent(Math.abs(diff) * 100 / point.previousBytes, locale, 1)}</b></span>
      </>}
    </div>}
  </div>
}
