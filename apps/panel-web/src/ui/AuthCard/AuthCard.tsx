import type { ReactNode } from 'react'
import styles from '@/ui/AuthCard/AuthCard.module.css'

export interface AuthCardProps {
  title: string
  subtitle?: ReactNode
  notice?: ReactNode
  children: ReactNode
}

export function AuthCard({ title, subtitle, notice, children }: AuthCardProps) {
  return (
    <section className={styles.card} aria-labelledby="auth-title">
      {notice}
      <div className={styles.head}>
        <h1 id="auth-title" className={styles.title}>
          {title}
        </h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
