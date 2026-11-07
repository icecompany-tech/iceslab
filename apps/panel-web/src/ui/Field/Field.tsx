import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from '@/ui/Field/Field.module.css'
import { Icon } from '@/ui/Icon/Icon'

interface FieldA11y {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** A refusal that is not the field's fault: amber, the same place. */
  warning?: ReactNode
  /** Read by the screen reader only: the group above the field already names it. */
  labelHidden?: boolean
  children: (a11y: FieldA11y) => ReactNode
}

/** Label, control, one line under it. A refusal stands at the field, not in a toast (F-K2). */
export function Field({ label, hint, error, warning, labelHidden = false, children }: FieldProps) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error ?? warning ?? hint
  return (
    <div className={styles.field}>
      <label className={labelHidden ? styles.labelHidden : styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        ...(note ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {note && (
        <div id={noteId} className={error ? styles.error : warning ? styles.warning : styles.hint}>
          {note}
        </div>
      )}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean
  fieldSize?: 'sm' | 'md'
}

export function Input({ mono = false, fieldSize = 'md', className, ...rest }: InputProps) {
  const classes = [styles.input, styles[fieldSize], mono ? styles.mono : '', className ?? ''].join(' ')
  return <input className={classes} {...rest} />
}

export interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  showLabel: string
  hideLabel: string
}

export function PasswordInput({ showLabel, hideLabel, ...rest }: PasswordInputProps) {
  const [shown, setShown] = useState(false)
  return (
    <div className={styles.withAction}>
      <input {...rest} type={shown ? 'text' : 'password'} className={`${styles.input} ${styles.md} ${shown ? '' : styles.secret}`} />
      <button type="button" className={styles.action} aria-label={shown ? hideLabel : showLabel} aria-pressed={shown} onClick={() => setShown(!shown)}>
        <Icon name={shown ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  )
}
