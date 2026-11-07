import styles from '@/ui/CodeArea/CodeArea.module.css'

export interface CodeAreaProps {
  label: string
  value: string
  onChange?: (next: string) => void
  /** The line the server complained about, 1-based. */
  errorLine?: number | null
  readOnly?: boolean
  minRows?: number
}

const ROWS = 18

/**
 * Line numbers and monospace text, on purpose no code editor: the one question here is
 * where the error is, and the server's line number answers it. The gutter sits in the
 * same scrolling layer, so line 118 stays opposite line 118.
 */
export function CodeArea({ label, value, onChange, errorLine = null, readOnly = false, minRows = ROWS }: CodeAreaProps) {
  const lines = value.length === 0 ? 1 : value.split('\n').length
  const rows = Math.max(minRows, lines)
  return (
    <div className={errorLine ? styles.areaBad : styles.area}>
      <div className={styles.gutter} aria-hidden>
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <div key={n} className={n === errorLine ? styles.lineBad : n <= lines ? styles.line : styles.lineSpare}>
            {n}
          </div>
        ))}
      </div>
      <textarea aria-label={label} className={styles.text} value={value} readOnly={readOnly} spellCheck={false} rows={rows} wrap="off" onChange={(e) => onChange?.(e.target.value)} />
    </div>
  )
}
