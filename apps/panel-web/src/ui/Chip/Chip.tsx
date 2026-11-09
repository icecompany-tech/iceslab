import { fmtNumber } from '@/lib/format'
import { useLocale } from '@/lib/i18n'
import styles from '@/ui/Chip/Chip.module.css'

export interface ChipProps {
  label: string
  count?: number
  /** A status dot before the word: red for problems, a ring for "not verified". */
  dot?: 'danger' | 'unknown' | 'amber'
  active?: boolean
  onClick: () => void
}

/** The count is grouped by the locale, as the frames draw it: «1 358». */
export function Chip({ label, count, dot, active = false, onClick }: ChipProps) {
  const { locale } = useLocale()
  return (
    <button type="button" className={`${styles.chip} ${active ? styles.active : ''}`} aria-pressed={active} onClick={onClick}>
      {dot && <span className={`${styles.dot} ${styles[dot]}`} />}
      {label}
      {count !== undefined && <span className={styles.count}>{fmtNumber(count, locale)}</span>}
    </button>
  )
}
