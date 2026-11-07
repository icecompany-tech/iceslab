import type { ReactNode } from 'react'
import styles from '@/ui/Banner/Banner.module.css'
import { Icon } from '@/ui/Icon/Icon'

export interface BannerProps {
  tone?: 'warn' | 'danger' | 'info'
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
}

export function Banner({ tone = 'warn', title, action, children }: BannerProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`${styles.banner} ${styles[tone]}`}>
      <span className={styles.icon}>
        <Icon name={tone === 'info' ? 'info' : 'warn'} size="lg" />
      </span>
      <div className={styles.text}>
        {title && <div className={styles.title}>{title}</div>}
        {children}
      </div>
      {action}
    </div>
  )
}
