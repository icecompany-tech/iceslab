import type { ReactNode } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import styles from '@/ui/Step/Step.module.css'

export interface StepProps {
  title: string
  /** What is chosen, shown on the closed step at the right. */
  value?: ReactNode
  /** A step one may skip is marked with a dot, not a circle. */
  optional?: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** A step of a form: one decision, its value when closed. Steps have no order unless numbered. */
export function Step({ title, value, optional = false, open, onToggle, children }: StepProps) {
  return (
    <section className={`${styles.step} ${open ? styles.open : ''}`}>
      <button type="button" className={styles.head} aria-expanded={open} onClick={onToggle}>
        <span className={`${styles.mark} ${optional ? styles.dot : ''}`} />
        <span className={styles.title}>{title}</span>
        {!open && value !== undefined && <span className={styles.value}>{value}</span>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size="md" />
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  )
}
