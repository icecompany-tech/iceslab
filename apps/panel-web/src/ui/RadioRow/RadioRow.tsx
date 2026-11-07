import type { ReactNode } from 'react'
import styles from '@/ui/RadioRow/RadioRow.module.css'

export interface RadioRowProps {
  name: string
  title: string
  description?: string
  checked: boolean
  /** Closed with its reason in a line, not hidden: the row says the choice exists. */
  closedReason?: string
  onSelect: () => void
  /** Fields of this choice, shown under the chosen row. */
  children?: ReactNode
}

export function RadioRow({ name, title, description, checked, closedReason, onSelect, children }: RadioRowProps) {
  return (
    <div className={`${styles.row} ${checked ? styles.on : ''} ${closedReason ? styles.closed : ''}`}>
      <label className={styles.head}>
        <input type="radio" className={styles.input} name={name} checked={checked} disabled={closedReason !== undefined} onChange={onSelect} />
        <span className={styles.circle} aria-hidden="true" />
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {(closedReason ?? description) && <span className={styles.description}>{closedReason ?? description}</span>}
        </span>
      </label>
      {checked && children && <div className={styles.body}>{children}</div>}
    </div>
  )
}
