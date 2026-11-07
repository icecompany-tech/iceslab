import { Fragment } from 'react'
import styles from '@/ui/CascadeFlow/CascadeFlow.module.css'
import { Flag } from '@/ui/Flag/Flag'

/** A point is a node, its colour the state; a ring is not a node: a named outbound has no leg of its own. */
export type FlowDot = 'ok' | 'down' | 'failed' | 'unknown' | 'off' | 'empty' | 'ring'

export interface FlowNode {
  key: string
  name: string
  dot: FlowDot
  note?: string
}

export interface FlowGroup {
  key: string
  title?: string
  code?: string | null
  /** A diamond and this word: the core picks among these nodes by measured latency. */
  balancer?: string
  nodes: readonly FlowNode[]
}

export interface FlowColumn {
  key: string
  title: string
  /** Who chooses at a fork. A diamond only when a balancer does, not when the client does. */
  caption?: string
  diamond?: boolean
  groups: readonly FlowGroup[]
}

export interface FlowLink {
  key: string
  over: string
  under: string
  tone?: 'danger' | 'pending'
}

export interface CascadeFlowProps {
  label: string
  columns: readonly FlowColumn[]
  links: readonly FlowLink[]
  legend?: string
}

const DOT = { ok: styles.ok, down: styles.down, failed: styles.failed, unknown: styles.unknown, off: styles.off, empty: styles.empty, ring: styles.ring } as const

function Diamond() {
  return <span className={styles.diamond} aria-hidden />
}

function Hop({ column }: { column: FlowColumn }) {
  return (
    <div className={styles.hop}>
      <span className={styles.hopTitle}>{column.title}</span>
      {column.groups.map((group) => (
        <div key={group.key} className={styles.group}>
          {(group.title || group.code) && (
            <span className={styles.groupTitle}>
              {group.code && <Flag code={group.code} />}
              {group.title}
            </span>
          )}
          {group.balancer && (
            <span className={styles.balancer}>
              <Diamond />
              {group.balancer}
            </span>
          )}
          <ul className={styles.nodes}>
            {group.nodes.map((node) => (
              <li key={node.key} className={styles.node}>
                <span className={styles.nodeLine}>
                  {group.nodes.length > 1 && <span className={node.dot === 'down' || node.dot === 'failed' ? styles.branchDead : styles.branch} aria-hidden />}
                  <span className={`${styles.dot} ${DOT[node.dot]}`} aria-hidden />
                  <span className={node.dot === 'empty' ? styles.nameEmpty : styles.name}>{node.name}</span>
                </span>
                {node.note && <span className={node.dot === 'failed' || node.dot === 'down' ? styles.noteDanger : styles.note}>{node.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {column.caption && (
        <span className={styles.caption}>
          {column.diamond && <Diamond />}
          {column.caption}
        </span>
      )}
    </div>
  )
}

/** The cascade as one reading from left to right: the main thing on every cascade screen. */
export function CascadeFlow({ label, columns, links, legend }: CascadeFlowProps) {
  return (
    <figure className={styles.flow} aria-label={label}>
      {legend && <figcaption className={styles.legend}>{legend}</figcaption>}
      <div className={styles.line}>
        {columns.map((column, i) => {
          const link = links[i]
          return (
            <Fragment key={column.key}>
              <Hop column={column} />
              {link && (
                <div className={link.tone === 'danger' ? styles.linkDanger : link.tone === 'pending' ? styles.linkPending : styles.link}>
                  <span className={styles.over}>{link.over}</span>
                  <span className={styles.wire} aria-hidden />
                  <span className={styles.under}>{link.under}</span>
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </figure>
  )
}
