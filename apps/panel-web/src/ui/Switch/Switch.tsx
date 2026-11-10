import styles from '@/ui/Switch/Switch.module.css'

export interface SwitchProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  /** In a table row: the column head says it, the label stays for a screen reader. */
  labelHidden?: boolean
  /** ui/Switch/on/locked: fixed in its state, half-faded, no hover, the reason as a hint. */
  lockedReason?: string
}

export function Switch({ label, checked, disabled, onChange, labelHidden = false, lockedReason }: SwitchProps) {
  const locked = lockedReason !== undefined
  return (
    <label className={`${styles.row} ${locked ? styles.locked : ''}`} title={lockedReason}>
      <span className={labelHidden ? styles.hidden : undefined}>{label}</span>
      <input type="checkbox" role="switch" className={styles.input} checked={checked} disabled={disabled || locked} aria-description={lockedReason} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.track} aria-hidden="true" />
    </label>
  )
}
