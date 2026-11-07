import type { ReactNode } from 'react'
import { Button } from '@/ui/Button/Button'
import { Icon } from '@/ui/Icon/Icon'
import styles from '@/ui/QueryState/QueryState.module.css'

export interface QueryFailedProps {
  title: string
  body: string
  retryLabel: string
  onRetry: () => void
}

/** A list or a number that did not arrive. It is not "empty" and not "zero" (F-K1). */
export function QueryFailed({ title, body, retryLabel, onRetry }: QueryFailedProps) {
  return (
    <div role="alert" className={styles.box}>
      <span className={styles.icon}>
        <Icon name="warn" size="xl" />
      </span>
      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{body}</div>
      <Button onClick={onRetry}>{retryLabel}</Button>
    </div>
  )
}

export function QueryLoading({ label }: { label: string }) {
  return (
    <div role="status" className={styles.loading}>
      {label}
    </div>
  )
}

/** The same failure, in one line at its place, when the rest of the screen stands. */
export function QueryFailedLine({ children, retryLabel, onRetry }: { children: ReactNode; retryLabel: string; onRetry: () => void }) {
  return (
    <div role="alert" className={styles.line}>
      <Icon name="warn" />
      <span className={styles.lineText}>{children}</span>
      <button type="button" className={styles.retry} onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  )
}
