import { useRef, useState, type MouseEvent } from 'react'
import { Meter } from '@/ui/Meter/Meter'
import styles from '@/ui/TrafficChart/TrafficChart.module.css'

export interface ChartPoint {
  /** The x of the tooltip title: "19:00". */
  label: string
  value: number
}

export interface TrafficChartProps {
  title: string
  points: readonly ChartPoint[]
  formatValue: (value: number) => string
}

const WIDTH = 1000
const HEIGHT = 240
const TOP = 16
// Half the tooltip, so it never leaves the block at either end.
const EDGE_PERCENT = 12

export function TrafficChart({ title, points, formatValue }: TrafficChartProps) {
  const tooltip = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...points.map((p) => p.value), 1)
  const x = (i: number) => (points.length < 2 ? WIDTH / 2 : (i * WIDTH) / (points.length - 1))
  const y = (value: number) => HEIGHT - (value / max) * (HEIGHT - TOP)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.value)}`).join(' ')
  const area = `${line} L${x(points.length - 1)} ${HEIGHT} L${x(0)} ${HEIGHT} Z`
  const point = hovered === null ? undefined : points[hovered]

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const at = (event.clientX - box.left) / box.width
    const index = Math.round(at * (points.length - 1))
    setHovered(index)
    // Set on the element, not a style attribute: the page's CSP refuses those.
    const percent = Math.min(Math.max((index / Math.max(points.length - 1, 1)) * 100, EDGE_PERCENT), 100 - EDGE_PERCENT)
    tooltip.current?.style.setProperty('left', `${percent}%`)
  }

  return (
    <div className={styles.chart} role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHovered(null)}>
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="traffic-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className={styles.areaTop} />
            <stop offset="100%" className={styles.areaBottom} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#traffic-area)" />
        <path d={line} className={styles.line} />
        {hovered !== null && <line x1={x(hovered)} x2={x(hovered)} y1={0} y2={HEIGHT} className={styles.cursor} />}
      </svg>
      <div ref={tooltip} className={`${styles.tooltip} ${point ? styles.shown : ''}`}>
        {point && (
          <>
            <div className={styles.tipTitle}>{point.label}</div>
            <div className={styles.tipValue}>{formatValue(point.value)}</div>
            <Meter percent={(point.value / max) * 100} />
          </>
        )}
      </div>
    </div>
  )
}
