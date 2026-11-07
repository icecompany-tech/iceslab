import type { ReactNode } from 'react'
import styles from '@/ui/AuthNotice/AuthNotice.module.css'
import { Icon } from '@/ui/Icon/Icon'

export interface AuthNoticeProps {
  tone: 'warn' | 'info'
  children: ReactNode
}

export function AuthNotice({ tone, children }: AuthNoticeProps) {
  return (
    <div role={tone === 'warn' ? 'alert' : 'status'} className={`${styles.notice} ${styles[tone]}`}>
      <span className={styles.icon}>
        <Icon name={tone === 'warn' ? 'warn' : 'check'} />
      </span>
      <span className={styles.text}>{children}</span>
    </div>
  )
}
