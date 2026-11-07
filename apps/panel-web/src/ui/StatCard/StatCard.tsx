import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/ui/Icon/Icon'
import styles from '@/ui/StatCard/StatCard.module.css'

export interface StatCardProps {
  label: string
  icon: IconName
  /** Top right: a unit or a percent, when the card has one. */
  aside?: ReactNode
  value: ReactNode
  /** The small part after the value: "из 13". */
  valueNote?: ReactNode
  size?: 'stat' | 'metric'
  children?: ReactNode
}

export function StatCard({ label, icon, aside, value, valueNote, size = 'stat', children }: StatCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.label}>{label}</h3>
        {aside !== undefined ? <span className={styles.aside}>{aside}</span> : <Icon name={icon} size="lg" />}
      </div>
      <div className={size === 'stat' ? styles.stat : styles.metric}>
        {value}
        {valueNote !== undefined && <span className={styles.valueNote}> {valueNote}</span>}
      </div>
      {children}
    </section>
  )
}
