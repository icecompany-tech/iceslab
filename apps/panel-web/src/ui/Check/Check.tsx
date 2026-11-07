import { useEffect, useRef } from 'react'
import styles from '@/ui/Check/Check.module.css'

export interface CheckProps {
  label: string
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}

/** The native box for the keyboard and the reader, drawn over: 16 px, radius 5 (design 04.11). */
export function Check({ label, checked, indeterminate = false, disabled, onChange }: CheckProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input ref={ref} type="checkbox" aria-label={label} className={styles.check} checked={checked} disabled={disabled} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.checked)} />
}
