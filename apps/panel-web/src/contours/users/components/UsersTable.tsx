import { isOnlineAt } from '@iceslab/shared'
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ColumnFilterCell } from '@/contours/users/components/ColumnFilterCell'
import type { DialogKind } from '@/contours/users/components/ActionDialogs'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import type { ListState } from '@/contours/users/hooks/useListState'
import { widthOf, type ColumnId, type ColumnView, type UserColumn } from '@/contours/users/lib/columns'
import { statusWord, subscriptionUrl, type User } from '@/contours/users/lib/users'
import { useNow } from '@/lib/clock'
import type { NodeRow } from '@/lib/domain/nodes'
import type { Squad } from '@/lib/domain/squads'
import { fmtAge, fmtBytes, fmtDate, fmtDateTime, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Check } from '@/ui/Check/Check'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { Menu } from '@/ui/Menu/Menu'
import { Meter } from '@/ui/Meter/Meter'
import { meterTone } from '@/ui/Meter/tone'
import { useToast } from '@/ui/Toast/useToast'

export type Density = 'compact' | 'normal' | 'relaxed'

const SOON_DAYS = 7
const MIN_WIDTH = 48
/** The column that takes the window's spare width; the rest keep theirs. */
const STRETCH: ColumnId = 'username'

export interface TableContext {
  nodes: ReadonlyMap<string, NodeRow>
  squads: ReadonlyMap<string, Squad>
  panel: { publicUrl?: string | null; subscriptionPathPrefix?: string | null } | undefined
  allNodes: readonly NodeRow[]
}

interface RowHandlers {
  onOpen: (user: User) => void
  onDialog: (kind: DialogKind, user: User) => void
  onEnable: (user: User) => void
}

interface TableProps {
  layout: { columns: readonly UserColumn[]; view: ColumnView; onView: (next: ColumnView) => void; density: Density }
  list: ListState
  users: readonly User[]
  context: TableContext
  selection: { selected: ReadonlySet<string>; onSelect: (ids: readonly string[], on: boolean) => void }
  actions: RowHandlers
  empty: ReactNode
}

function Cell({ id, user, context }: { id: ColumnId; user: User; context: TableContext }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const at = now()
  const ago = (iso: string) => fmtAge((at - Date.parse(iso)) / 1000, locale)
  const dash = <span className={styles.muted}>{words.dash}</span>
  const when = (iso: string | null) => (iso ? fmtDateTime(iso, locale) : dash)
  switch (id) {
    case 'username':
      return (
        <span className={styles.userName}>
          <b className={user.status === 'disabled' ? styles.dimName : ''}>{user.username}</b>
          {user.telegramId && <span className={styles.handle}>{user.telegramId}</span>}
        </span>
      )
    case 'shortId':
      return <span className={styles.mono}>{user.shortId.slice(0, 6)}</span>
    case 'status': {
      const word = statusWord(user.status)
      return (
        <span className={styles.status}>
          <span className={`${styles.statusDot} ${styles[`dot_${word}`]}`} />
          <span className={word === 'expired' ? styles.danger : word === 'limited' ? styles.amber : word === 'disabled' ? styles.muted : ''}>{words.statusOne[word]}</span>
        </span>
      )
    }
    case 'lastNode': {
      if (!user.lastConnectedNodeId) return <span className={styles.muted}>{words.never}</span>
      if (!user.lastConnectedNodeName) return <span className={styles.muted}>{words.nodeGone}</span>
      return (
        <span className={styles.nodeCell}>
          <Flag code={context.nodes.get(user.lastConnectedNodeId)?.countryCode ?? null} />
          <span className={styles.nodeName}>{user.lastConnectedNodeName}</span>
          {isOnlineAt(user.lastOnlineAt, at) ? <span className={styles.online}>{words.onlineWord}</span> : user.lastOnlineAt && <span className={styles.fine}>{ago(user.lastOnlineAt)}</span>}
        </span>
      )
    }
    case 'expires': {
      if (!user.expireAt) return <span className={styles.muted}>{words.noTerm}</span>
      const left = (Date.parse(user.expireAt) - at) / 1000
      if (left < 0) return <span className={styles.danger}>{words.expiredAgo(fmtAge(-left, locale))}</span>
      const soon = left < SOON_DAYS * 86_400
      return <span className={soon ? styles.soon : ''}>{words.inDays(fmtAge(left, locale))}</span>
    }
    case 'used': {
      const percent = user.trafficLimitBytes ? (user.trafficUsedBytes / user.trafficLimitBytes) * 100 : null
      return (
        <span className={styles.usedCell}>
          <span className={user.status === 'disabled' ? styles.muted : ''}>{fmtBytes(user.trafficUsedBytes, locale)}</span>
          {percent === null ? <span className={styles.noMeter} /> : <Meter size="table" percent={percent} tone={meterTone(percent)} />}
        </span>
      )
    }
    case 'usedPct': {
      if (!user.trafficLimitBytes) return dash
      const percent = (user.trafficUsedBytes / user.trafficLimitBytes) * 100
      return <span className={percent > 60 ? styles.soon : styles.muted}>{fmtPercent(percent, locale)}</span>
    }
    case 'limit':
      return <span className={styles.muted}>{user.trafficLimitBytes === null ? '∞' : fmtBytes(user.trafficLimitBytes, locale)}</span>
    case 'squads':
      return <span className={styles.clip}>{user.groupIds.map((g) => context.squads.get(g)?.name ?? g).join(', ')}</span>
    case 'tag':
      return user.tag ? <span>{user.tag}</span> : dash
    case 'description':
      return user.description ? <span className={styles.clip}>{user.description}</span> : dash
    case 'telegramId':
      return user.telegramId ? <span>{user.telegramId}</span> : dash
    case 'email':
      return user.email ? <span className={styles.clip}>{user.email}</span> : dash
    case 'subLink': {
      const url = subscriptionUrl(user.subscriptionToken, context.panel)
      return url ? <span className={`${styles.clip} ${styles.mono}`}>{url}</span> : <span className={styles.muted}>{words.routingUnknown}</span>
    }
    case 'deviceLimit':
      if (user.hwidDeviceLimit === null) return <span className={styles.muted}>{words.deviceChoice.unset}</span>
      return user.hwidDeviceLimit === 0 ? <span className={styles.muted}>{words.deviceChoice.unlimited}</span> : <span>{user.hwidDeviceLimit}</span>
    case 'firstConnected':
      return when(user.firstConnectedAt)
    case 'lastOnline':
      return when(user.lastOnlineAt)
    case 'trafficReset':
      return when(user.lastTrafficResetAt)
    case 'lifetimeUsed':
      return <span>{fmtBytes(user.lifetimeTrafficBytes, locale)}</span>
    case 'linkRevoked':
      return user.subRevokedAt ? <span className={styles.danger}>{fmtDateTime(user.subRevokedAt, locale)}</span> : dash
    case 'created':
      return <span>{fmtDate(user.createdAt, locale)}</span>
    case 'uuid':
      return <span className={`${styles.mono} ${styles.clip}`}>{user.id}</span>
  }
}

function RowActions({ user, context, onDialog, onEnable }: { user: User; context: TableContext; onDialog: RowHandlers['onDialog']; onEnable: RowHandlers['onEnable'] }) {
  const words = useDict(DICT)
  const toast = useToast()
  const url = subscriptionUrl(user.subscriptionToken, context.panel)
  const noLink = url === null ? words.noLink : undefined
  const copy = () => {
    if (url) void navigator.clipboard?.writeText(url).then(() => toast.show(words.copied))
  }
  return (
    <span className={styles.rowActions}>
      <button type="button" className={styles.copyRow} aria-label={words.copyLink} disabled={url === null} title={noLink} onClick={copy}>
        <Icon name="copy" size="md" />
      </button>
      <Menu
        label={words.rowMenu(user.username)}
        items={[
          { id: 'copy', label: words.copyLink, icon: 'copy', disabledReason: noLink, onSelect: copy },
          { id: 'open', label: words.openSub, icon: 'external', disabledReason: noLink, onSelect: () => url && window.open(url, '_blank', 'noreferrer') },
          { id: 'extend', label: words.extend, icon: 'calendar', disabledReason: user.expireAt ? undefined : words.extendNoTerm, onSelect: () => onDialog('extend', user) },
          { id: 'reset', label: words.resetTraffic, icon: 'rotateLeft', onSelect: () => onDialog('reset', user) },
          user.status === 'disabled' ? { id: 'enable', label: words.enable, icon: 'power', onSelect: () => onEnable(user) } : { id: 'disable', label: words.disable, icon: 'power', onSelect: () => onDialog('disable', user) },
          { id: 'rotate', label: words.rotate, icon: 'key', divider: true, onSelect: () => onDialog('rotate', user) },
          { id: 'revoke', label: words.revoke, icon: 'ban', tone: 'danger', onSelect: () => onDialog('revoke', user) },
          { id: 'remove', label: words.remove, icon: 'trash', tone: 'danger', onSelect: () => onDialog('remove', user) },
        ]}
      />
    </span>
  )
}

export function UsersTable({ layout, list, users, context, selection, actions, empty }: TableProps) {
  const { columns, view, onView, density } = layout
  const { selected, onSelect } = selection
  const { onOpen, onDialog, onEnable } = actions
  const words = useDict(DICT)
  const table = useRef<HTMLTableElement>(null)
  const pageIds = users.map((u) => u.id)
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someOn = pageIds.some((id) => selected.has(id))
  const [dragging, setDragging] = useState<{ id: ColumnId; width: number } | null>(null)

  // Sticky offsets are set on the elements: the page's CSP refuses style attributes.
  useLayoutEffect(() => {
    const root = table.current
    if (!root) return
    const leftPins = columns.filter((c) => view.pins[c.id] === 'left')
    const rightPins = columns.filter((c) => view.pins[c.id] === 'right')
    const place = (id: string, side: 'left' | 'right', offset: number) => {
      for (const el of root.querySelectorAll<HTMLElement>(`[data-col="${id}"]`)) el.style[side] = `${offset}px`
    }
    const drawn = (id: string) => root.querySelector<HTMLElement>(`th[data-col="${id}"]`)?.offsetWidth ?? 0
    // The table is at least the sum of its columns and scrolls sideways past it; a wider window
    // goes to «Юзер», whose col has no width of its own (DECISIONS 10.11, window 1920).
    root.style.minWidth = `${drawn('select') + drawn('actions') + columns.reduce((sum, c) => sum + widthOf(c, view), 0)}px`
    let left = drawn('select')
    for (const column of leftPins) {
      place(column.id, 'left', left)
      left += drawn(column.id)
    }
    let right = drawn('actions')
    for (const column of [...rightPins].reverse()) {
      place(column.id, 'right', right)
      right += drawn(column.id)
    }
  }, [columns, view, users])

  const startResize = (column: UserColumn, event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    const startX = event.clientX
    // From the drawn width: «Юзер» may be wider than its stored one.
    const startWidth = event.currentTarget.closest('th')?.offsetWidth ?? widthOf(column, view)
    setDragging({ id: column.id, width: startWidth })
    const onMove = (move: globalThis.PointerEvent) => {
      const width = Math.max(MIN_WIDTH, startWidth + move.clientX - startX)
      setDragging({ id: column.id, width })
      onView({ ...view, widths: { ...view.widths, [column.id]: width } })
    }
    const onUp = () => {
      setDragging(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const pinClass = (id: ColumnId) => (view.pins[id] ? styles.pinned : '')
  // «Юзер» takes the spare width unless the operator sized it or hid it; then an empty cell before
  // the actions does, and no other column stretches (owner 10.11).
  const stretches = columns.some((c) => c.id === STRETCH) && view.widths[STRETCH] === undefined
  const lastId = columns.at(-1)?.id

  return (
    <div className={styles.tableScroll}>
      <table ref={table} className={`${styles.table} ${styles[density]}`}>
        <colgroup>
          <col className={styles.colSelect} />
          {columns.map((c) => (
            <col key={c.id} width={c.id === STRETCH && stretches ? undefined : widthOf(c, view)} />
          ))}
          {!stretches && <col />}
          <col className={styles.colActions} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" data-col="select" className={`${styles.selectCell} ${styles.pinned}`}>
              <Check label={words.selectAll} checked={allOn} indeterminate={someOn && !allOn} disabled={pageIds.length === 0} onChange={(on) => onSelect(pageIds, on)} />
            </th>
            {columns.map((column) => {
              const sorted = list.sort.by === column.sort
              return (
                <th key={column.id} scope="col" data-col={column.id} className={pinClass(column.id)} aria-sort={sorted ? (list.sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <div className={`${styles.headTop} ${sorted ? styles.headSorted : ''}`}>
                    {column.sort ? (
                      <button type="button" className={styles.sortButton} onClick={() => column.sort && list.toggleSort(column.sort)}>
                        {words.column[column.id]}
                        <Icon name={sorted ? (list.sort.order === 'asc' ? 'sortDown' : 'sortUp') : 'sort'} size="sm" />
                      </button>
                    ) : (
                      words.column[column.id]
                    )}
                  </div>
                  {column.filter && (
                    <div className={styles.headFilter}>
                      <ColumnFilterCell filter={column.filter} list={list} nodes={context.allNodes} label={words.filterOf(words.column[column.id])} />
                    </div>
                  )}
                  <span
                    className={`${styles.resize} ${column.id === lastId ? styles.resizeLast : ''} ${dragging?.id === column.id ? styles.resizing : ''}`}
                    role="separator"
                    aria-label={words.resizeColumn(words.column[column.id])}
                    onPointerDown={(e) => startResize(column, e)}
                  >
                    {dragging?.id === column.id && <span className={styles.resizeLabel}>{words.widthPx(Math.round(dragging.width))}</span>}
                  </span>
                </th>
              )
            })}
            {!stretches && <th scope="col" className={styles.filler} aria-hidden="true" />}
            <th scope="col" data-col="actions" className={`${styles.actionsCell} ${styles.pinned}`} aria-label={words.rowMenu('')} />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const word = statusWord(user.status)
            return (
              <tr key={user.id} className={`${styles.row} ${word === 'expired' ? styles.rowExpired : word === 'limited' ? styles.rowLimited : ''} ${selected.has(user.id) ? styles.rowSelected : ''}`} onClick={() => onOpen(user)}>
                <td data-col="select" className={`${styles.selectCell} ${styles.pinned}`} onClick={(e) => e.stopPropagation()}>
                  <Check label={words.selectUser(user.username)} checked={selected.has(user.id)} onChange={(on) => onSelect([user.id], on)} />
                </td>
                {columns.map((column) => (
                  <td key={column.id} data-col={column.id} className={pinClass(column.id)}>
                    <Cell id={column.id} user={user} context={context} />
                  </td>
                ))}
                {!stretches && <td className={styles.filler} />}
                <td data-col="actions" className={`${styles.actionsCell} ${styles.pinned}`} onClick={(e) => e.stopPropagation()}>
                  <RowActions user={user} context={context} onDialog={onDialog} onEnable={onEnable} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {users.length === 0 && empty}
    </div>
  )
}
