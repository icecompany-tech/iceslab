import type { ReactNode } from 'react'
import { Button } from '@/ui/Button/Button'
import layout from '@/ui/QueryState/QueryState.module.css'
import styles from './review.module.css'

const icons = {
  warn: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4 L21 20 H3 Z M12 10 V14.5 M12 17.4 V17.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  rules: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 6 L5 7.5 L7.5 5 M3.5 12 L5 13.5 L7.5 11 M3.5 18 L5 19.5 L7.5 17 M11 6.5 H20.5 M11 12.5 H20.5 M11 18.5 H20.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  network: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 3 H15 V8 H9 Z M3 16 H9 V21 H3 Z M15 16 H21 V21 H15 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 8 V12 M6 16 V12 H18 V16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  block: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.6 5.6 L18.4 18.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  monitor: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 4 H21 V16 H3 Z M8 20 H16 M12 16 V20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
  chart: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 21 H21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 17 V12 M12 17 V5 M18 17 V9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
}

export function ReviewPageState({ icon = 'warn', title, body, retry, children }: {
  icon?: keyof typeof icons; title: string; body: string; retry?: () => void; children?: ReactNode
}) {
  return <section role={retry ? 'alert' : undefined} className={layout.emptyPage}>
    <span className={layout.emptyIcon + (retry ? ' ' + styles.failureIcon : '')}>{icons[icon]}</span>
    <h2>{title}</h2>
    <p>{body}</p>
    {retry && <Button size="sm" onClick={retry}>Повторить</Button>}
    {children}
  </section>
}
