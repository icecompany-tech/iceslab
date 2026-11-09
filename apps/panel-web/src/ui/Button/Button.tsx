import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '@/ui/Button/Button.module.css'

export type ButtonVariant = 'primary' | 'normal' | 'danger' | 'warn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** 40 on setting pages, 32 in panels and windows. */
  size?: 'md' | 'sm'
  icon?: ReactNode
  loading?: boolean
  wide?: boolean
}

/** One style for every button, owner 2026-11-05: no fill, a border and text in the kind's colour. */
export function Button({ variant = 'normal', size = 'sm', icon, loading = false, wide = false, type = 'button', disabled, children, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], wide ? styles.wide : '', icon ? styles.withIcon : ''].join(' ')
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {icon}
      {children}
    </button>
  )
}
