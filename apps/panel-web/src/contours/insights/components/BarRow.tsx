import styles from '@/contours/insights/components/insights.module.css'
import { Meter } from '@/ui/Meter/Meter'

/** A named bar relative to the biggest row: the leader fills the track, the rest read as a share of it. */
export function BarRow({ label, value, percent, tone }: { label: string; value: string; percent: number; tone?: 'accent' | 'amber' }) {
  return (
    <div className={styles.bar}>
      <div className={styles.barHead}>
        <span>{label}</span>
        <span className={styles.barValue}>{value}</span>
      </div>
      <Meter size="table" percent={percent} tone={tone ?? 'accent'} />
    </div>
  )
}
