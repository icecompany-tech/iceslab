import { Fragment, useLayoutEffect, useRef } from 'react'
import styles from '@/ui/CascadeFlow/CascadeFlow.module.css'
import { drawWires } from '@/ui/CascadeFlow/wires'
import { useLocale } from '@/lib/i18n'
import { Flag } from '@/ui/Flag/Flag'

/** A point is a node, its colour the state; a ring is not a node: a named outbound has no leg of its own. */
export type FlowDot = 'ok' | 'down' | 'failed' | 'unknown' | 'off' | 'empty' | 'ring'

export interface FlowNode {
  key: string
  name: string
  address?: string
  country?: string | null
  version?: string | undefined
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

function Hop({ column, captionOnLink }: { column: FlowColumn; captionOnLink: boolean }) {
  const { locale } = useLocale()
  const regions = new Intl.DisplayNames([locale], { type: 'region' })
  return (
    <div className={styles.hop} data-exit={column.key === 'exit'}>
      <span className={styles.hopTitle}>{column.title}</span>
      <div className={styles.groups}>
        {column.groups.map((group) => (
          <div key={group.key} className={styles.group}>
            {(group.title || group.code || group.balancer) && (
              <div className={styles.groupLabel}>
                {(group.title || group.code) && (
                  <span className={styles.groupTitle}>
                    {group.code && <strong>{/^[A-Z]{2}$/.test(group.code) ? regions.of(group.code) : group.code}</strong>}
                    {group.title}
                  </span>
                )}
                {group.balancer && <span className={styles.balancer}>{group.balancer}</span>}
              </div>
            )}
            <ul className={styles.nodes}>
              {group.nodes.map((node) => (
                <li key={node.key} className={styles.node} data-failed={node.dot === 'down' || node.dot === 'failed'}>
                  <span className={`${styles.dot} ${DOT[node.dot]}`} aria-hidden />
                  <div className={styles.nodeDetails}>
                    <span className={styles.nodeLine}>
                      {node.country && <Flag code={node.country} />}
                      <span className={node.dot === 'empty' ? styles.nameEmpty : styles.name}>{node.name}</span>
                    </span>
                    {node.address && <span className={styles.address}>{node.address}</span>}
                    {node.note && (
                      <span className={node.dot === 'failed' || node.dot === 'down' ? styles.noteDanger : styles.note}>
                        {node.note}{node.dot === 'ok' && column.key !== 'exit' && node.version ? ', ' + node.version : ''}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {column.caption && !captionOnLink && (
        <span className={styles.caption}>
          {column.caption}
        </span>
      )}
    </div>
  )
}

/** The cascade as one reading from left to right: the main thing on every cascade screen. */
export function CascadeFlow({ label, columns, links, legend }: CascadeFlowProps) {
  const diagram = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const track = diagram.current!
    const paint = () => drawWires(track, columns, links)
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(track)
    return () => observer.disconnect()
  }, [columns, links])

  return (
    <figure className={styles.flow} aria-label={label}>
      {legend && <figcaption className={styles.accessibleLegend}>{legend}</figcaption>}
      <div className={styles.line} tabIndex={0}>
        <div ref={diagram} className={styles.track}>
          <svg className={styles.wires} aria-hidden="true">
            <path />
            <path className={styles.failedWire} />
            <path className={styles.pendingWire} />
            <path className={styles.dangerWire} />
            <path className={styles.diamond} />
          </svg>
          {columns.map((column, i) => {
            const link = links[i]
            const forkCaption = columns[i + 1]?.key === 'exit' ? columns[i + 1]?.caption : undefined
            return (
              <Fragment key={column.key}>
                <Hop column={column} captionOnLink={column.key === 'exit' && i > 0 && Boolean(links[i - 1])} />
                {link && (
                  <div className={styles.link} data-tone={link.tone}>
                    <span className={styles.over}>{link.over}</span>
                    <span className={styles.under} title={forkCaption ? link.under : undefined}>{forkCaption ?? link.under}</span>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    </figure>
  )
}
