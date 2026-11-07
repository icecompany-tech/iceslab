import styles from '@/ui/Switch/Switch.module.css'

export interface SwitchProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  /** In a table row: the column head says it, the label stays for a screen reader. */
  labelHidden?: boolean
}

export function Switch({ label, checked, disabled, onChange, labelHidden = false }: SwitchProps) {
  return (
    <label className={styles.row}>
      <span className={labelHidden ? styles.hidden : undefined}>{label}</span>
      <input type="checkbox" role="switch" className={styles.input} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.track} aria-hidden="true" />
    </label>
  )
}
