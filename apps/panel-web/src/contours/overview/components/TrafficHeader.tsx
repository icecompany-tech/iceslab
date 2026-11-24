import type { ReactNode } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import styles from './blocks.module.css'

export function TrafficHeader({ title, value, summary, current, previous, controls }: {
  title: string; value?: string; summary?: ReactNode; current?: string; previous?: string; controls: ReactNode
}) {
  return <div className={styles.trafficHead}>
    <div className={styles.trafficSummary}>
      <h2 className={styles.heading}><Icon name="traffic" size="lg" />{title}</h2>
      {value && <div className={styles.hero}>{value}</div>}
      {summary && <div className={styles.compare}>{summary}</div>}
    </div>
    <div className={styles.plotControls}>
      {(current || previous) && <div className={styles.legend}>
        {current && <span>{current}</span>}
        {previous && <span data-previous>{previous}</span>}
      </div>}
      {controls}
    </div>
  </div>
}
