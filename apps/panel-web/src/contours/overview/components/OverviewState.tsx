import type { ReactNode } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import styles from './blocks.module.css'

interface Props {
  kind: 'traffic' | 'nodes' | 'error'
  title: string
  body: string
  children?: ReactNode
}

export function OverviewState({ kind, title, body, children }: Props) {
  return <div className={styles.state} data-kind={kind} role={kind === 'error' ? 'alert' : undefined}>
    <span className={styles.stateIcon}><Icon name={kind === 'error' ? 'warn' : kind === 'nodes' ? 'nodes' : 'traffic'} size="xl" /></span>
    <h3>{title}</h3>
    <p>{body}</p>
    {children}
  </div>
}
