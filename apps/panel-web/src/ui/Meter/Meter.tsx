import styles from '@/ui/Meter/Meter.module.css'

import type { MeterTone } from '@/ui/Meter/tone'

export interface MeterProps {
  percent: number
  tone?: MeterTone
  size?: 'card' | 'table'
  label?: string
}

const PERCENT_MAX = 100

/** An SVG and not a div with a width: the page's CSP has no room for inline styles. */
export function Meter({ percent, tone = 'accent', size = 'card', label }: MeterProps) {
  const width = Math.min(Math.max(percent, 0), PERCENT_MAX)
  return (
    <svg className={`${styles.meter} ${size === 'table' ? styles.table : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect className={styles.track} width="100%" height="100%" />
      <rect className={`${styles.value} ${styles[tone]}`} width={`${width}%`} height="100%" />
    </svg>
  )
}

