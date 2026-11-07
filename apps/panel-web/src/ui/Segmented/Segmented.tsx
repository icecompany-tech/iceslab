import styles from '@/ui/Segmented/Segmented.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Closed with its reason: the server has no such data (F-K4). */
  disabledReason?: string
}

export interface SegmentedProps<T extends string> {
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabledReason !== undefined}
          title={option.disabledReason}
          className={`${styles.segment} ${option.value === value ? styles.on : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
