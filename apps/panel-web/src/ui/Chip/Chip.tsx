import styles from '@/ui/Chip/Chip.module.css'

export interface ChipProps {
  label: string
  count?: number
  /** A status dot before the word: red for problems, a ring for "not verified". */
  dot?: 'danger' | 'unknown' | 'amber'
  active?: boolean
  onClick: () => void
}

export function Chip({ label, count, dot, active = false, onClick }: ChipProps) {
  return (
    <button type="button" className={`${styles.chip} ${active ? styles.active : ''}`} aria-pressed={active} onClick={onClick}>
      {dot && <span className={`${styles.dot} ${styles[dot]}`} />}
      {label}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  )
}
