import type { SelectHTMLAttributes } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import styles from '@/ui/Select/Select.module.css'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[]
  /** `chip` is the language control of the sign-in header, `field` a form's. */
  look?: 'field' | 'chip' | 'filter'
}

/** A native select: it needs no library and no bytes. Search lives in ui/SquadSelect. */
export function Select({ options, look = 'field', className, ...rest }: SelectProps) {
  return (
    <div className={`${styles.wrap} ${styles[look]} ${className ?? ''}`}>
      <select className={styles.select} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className={styles.chevron}>
        <Icon name="chevronDown" size="md" />
      </span>
    </div>
  )
}
