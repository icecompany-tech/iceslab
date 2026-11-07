import { useState } from 'react'
import styles from '@/ui/CodeInput/CodeInput.module.css'

export const CODE_LENGTH = 6

export interface CodeInputProps {
  id?: string
  label?: string
  value: string
  onChange: (next: string) => void
  invalid?: boolean
  describedBy?: string
}

/**
 * Six cells on the frame, one input underneath: paste, the password manager's one-time
 * code and a screen reader all get a single field, not six.
 */
export function CodeInput({ id, label, value, onChange, invalid = false, describedBy }: CodeInputProps) {
  const [focused, setFocused] = useState(false)
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '')
  const caret = Math.min(value.length, CODE_LENGTH - 1)
  return (
    <div className={styles.code}>
      <input
        id={id}
        className={styles.input}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={CODE_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {cells.map((digit, i) => (
        // The six are only a picture of the one input above.
        <div key={i} aria-hidden="true" className={[styles.cell, invalid ? styles.invalid : '', focused && i === caret && !invalid ? styles.active : ''].join(' ')}>
          {digit || (focused && i === caret && value.length < CODE_LENGTH ? <span className={styles.caret} /> : null)}
        </div>
      ))}
    </div>
  )
}
