import { engineLabel, sortEngines } from '@/lib/domain/engines'
import styles from '@/ui/CoreChip/CoreChip.module.css'

const SHOWN = 2

export interface CoreChipsProps {
  engines: readonly string[]
  tone?: 'accent' | 'danger' | 'muted'
}

/** No more than two badges and a "+N" counter, in the order of the frames (design 2026-11-04). */
export function CoreChips({ engines, tone = 'accent' }: CoreChipsProps) {
  const sorted = sortEngines(engines)
  const rest = sorted.length - SHOWN
  return (
    <span className={styles.row}>
      {sorted.slice(0, SHOWN).map((name) => (
        <span key={name} className={`${styles.chip} ${styles[tone]}`}>
          {engineLabel(name)}
        </span>
      ))}
      {rest > 0 && <span className={`${styles.chip} ${styles.muted}`} title={sorted.slice(SHOWN).map(engineLabel).join(', ')}>{`+${rest}`}</span>}
    </span>
  )
}
