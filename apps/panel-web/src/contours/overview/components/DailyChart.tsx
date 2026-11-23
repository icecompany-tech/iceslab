import { useState } from 'react'
import type { Overview } from '@/lib/domain/overview'
import { fmtBytes, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { DICT } from '@/contours/overview/dict'
import styles from './blocks.module.css'

type Days = NonNullable<NonNullable<Overview['traffic']>['dailyComparison']>
const left = 52, right = 1004, top = 18, bottom = 226, width = 1088, height = 268

export function DailyChart({ days }: { days: Days }) {
  const { locale } = useLocale()
  const words = useDict(DICT)
  const [at, setAt] = useState<number | null>(null)
  const max = Math.max(1, ...days.map(d => Math.max(d.bytes, d.previousBytes)))
  const unit = 1024 ** Math.floor(Math.log(max) / Math.log(1024))
  const rough = max / unit / 4
  const step = 10 ** Math.floor(Math.log10(rough))
  const ceiling = Math.ceil(rough / step) * step * 4 * unit
  const x = (i: number) => left + (right - left) * i / Math.max(1, days.length - 1)
  const y = (v: number) => bottom - (bottom - top) * v / ceiling
  const path = (key: 'bytes' | 'previousBytes') => {
    const first = days[0]
    if (!first) return ''
    let d = 'M' + x(0) + ' ' + y(first[key])
    days.slice(1).forEach((next, i) => {
      const start = days[i]!
      const delta = (x(i+1)-x(i))/3
      const clamp = (n: number) => Math.max(Math.min(start[key],next[key]), Math.min(n,Math.max(start[key],next[key])))
      const a = clamp(start[key] + (next[key]-(days[i-1] ?? start)[key])/6)
      const b = clamp(next[key] - ((days[i+2] ?? next)[key]-start[key])/6)
      d += ' C'+(x(i)+delta)+' '+y(a)+' '+(x(i+1)-delta)+' '+y(b)+' '+x(i+1)+' '+y(next[key])
    })
    return d
  }
  const extremes = days.reduce((acc, d, i) => ({
    min: d.bytes < days[acc.min]!.bytes ? i : acc.min,
    max: d.bytes > days[acc.max]!.bytes ? i : acc.max,
  }), { min:0, max:0 })
  const last = days.at(-1)!
  const current = path('bytes')
  const day = at === null ? undefined : days[at]
  const diff = day ? day.bytes - day.previousBytes : 0
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : ''
  const dateLabel = (s: string, weekday = false) => new Date(s).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month:'short', ...(weekday ? { weekday:'short' } : {}) })
  const pick = (n: number) => setAt(Math.min(days.length - 1, Math.max(0, n)))
  const dx = (right - left) / Math.max(1, days.length - 1)
  return <div className={styles.daily} role="group" aria-label={words.trafficFor['30d']} tabIndex={0}
    onFocus={() => setAt(0)} onBlur={() => setAt(null)}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { setAt(null); return }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        pick((at ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))
      }
    }}
    onMouseMove={(event) => {
      const box = event.currentTarget.getBoundingClientRect()
      pick(Math.round(((event.clientX - box.left) * width / box.width - left) / dx))
    }} onMouseLeave={() => setAt(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="overview-month-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".20" />
        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
      </linearGradient></defs>
      {days.map((d,i) => [0,6].includes(new Date(d.date).getUTCDay()) && <rect key={d.date} x={Math.max(left,x(i)-dx/2)} y={top} width={Math.min(right,x(i)+dx/2)-Math.max(left,x(i)-dx/2)} height={bottom-top} fill="var(--color-accent)" opacity=".035" />)}
      {[0,1,2,3,4].map(n => <g key={n}><line x1={left} x2={right} y1={y(n * ceiling/4)} y2={y(n * ceiling/4)} stroke="var(--color-border)" strokeDasharray={n ? '2 4' : undefined} />
        <text x={left-10} y={y(n * ceiling/4)+4} textAnchor="end">{n ? fmtBytes(n*ceiling/4,locale) : '0'}</text></g>)}
      {days.map((d,i) => i%7===0 && <text key={d.date} x={x(i)} y={bottom+22} textAnchor="middle">{dateLabel(d.date)}</text>)}
      <path d={current+' L'+x(days.length-1)+' '+bottom+' L'+left+' '+bottom+' Z'} fill="url(#overview-month-fill)" />
      <path d={path('previousBytes')} fill="none" stroke="var(--color-amber)" strokeWidth="1.6" strokeDasharray="5 4" />
      <path d={current} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      {(['max','min'] as const).map(key => {
        const i = extremes[key], d = days[i]!
        if (key === 'min' && extremes.min === extremes.max) return null
        return <g key={key}><circle cx={x(i)} cy={y(d.bytes)} r="3.5" fill="var(--color-bg)" stroke="var(--color-accent)" />
          <text x={x(i)} y={key === 'max' ? Math.max(12, y(d.bytes)-11) : Math.min(bottom+4,y(d.bytes)+16)} textAnchor="middle">{words[key]} {fmtBytes(d.bytes,locale)}, {dateLabel(d.date)}</text></g>
      })}
      {(['bytes','previousBytes'] as const).map((key,i) => {
        const center = i ? Math.max(y(last.previousBytes)+13,y(last.bytes)+24) : y(last.bytes)-12
        const pos = Math.max(12,Math.min(bottom,center))
        const color = i ? 'var(--color-amber)' : 'var(--color-accent)'
        return <g key={key}><rect x="1014" y={pos-11} width="69" height="23" rx="11" fill={color} fillOpacity={i ? 1 : .16} stroke={i ? undefined : 'var(--color-accent-edge)'} />
          <text className={i ? styles.endLabel+' '+styles.previousEndLabel : styles.endLabel} x="1048" y={pos+4} textAnchor="middle">{fmtBytes(last[key],locale)}</text></g>
      })}
      {day && at !== null && <g><line x1={x(at)} x2={x(at)} y1={top} y2={bottom} stroke="var(--color-text-muted)" strokeDasharray="3 4" />
        <circle cx={x(at)} cy={y(day.bytes)} r="4" fill="var(--color-accent)" /></g>}
    </svg>
    {day && at !== null && <div className={styles.dailyTip} ref={el => { if (!el) return
      const parentWidth = el.parentElement!.clientWidth
      const marker = x(at)/width*parentWidth
      const nextLeft = marker+14+el.offsetWidth <= parentWidth ? marker+14 : marker-el.offsetWidth-14
      el.style.left = Math.max(0,nextLeft)+'px'
      el.style.top = Math.min(height-el.offsetHeight,Math.max(y(day.bytes),y(day.previousBytes))+26)+'px' }}>
      <strong>{dateLabel(day.date,true)}</strong><span>{words.thisDay}<b>{fmtBytes(day.bytes,locale)}</b></span>
      <span>{words.previousDay}<b>{fmtBytes(day.previousBytes,locale)}</b></span>
      <span>{words.difference}<b>{sign}{fmtBytes(Math.abs(diff),locale)}{day.previousBytes > 0 && ' · '+sign+fmtPercent(Math.abs(diff)*100/day.previousBytes,locale,1)}</b></span>
    </div>}
  </div>
}
