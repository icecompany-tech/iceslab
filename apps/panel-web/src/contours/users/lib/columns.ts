// Every column of the list. A filter exists only where GET /api/users narrows by it: a filter
// the server cannot honour would return the whole list and look like it worked.
import { readStored } from '@/lib/storage'
import { arr, obj, record, str, nullable } from '@/lib/net/parse'

export type ColumnId =
  | 'username'
  | 'shortId'
  | 'status'
  | 'lastNode'
  | 'connection'
  | 'expires'
  | 'used'
  | 'usedPct'
  | 'limit'
  | 'squads'
  | 'tag'
  | 'description'
  | 'telegramId'
  | 'email'
  | 'subLink'
  | 'deviceLimit'
  | 'firstConnected'
  | 'lastOnline'
  | 'trafficReset'
  | 'lifetimeUsed'
  | 'linkRevoked'
  | 'created'
  | 'uuid'

export type FilterParam =
  | 'nodeId'
  | 'online'
  | 'expiresBefore'
  | 'expiresAfter'
  | 'hasExpiry'
  | 'trafficLimit'
  | 'usedOver'
  | 'usedUnder'
  | 'deviceLimit'
  | 'telegram'
  | 'email'
  | 'revoked'
  | 'hasTag'
  | 'createdBefore'
  | 'createdAfter'
  | 'firstConnectedBefore'
  | 'firstConnectedAfter'
  | 'groupId'
  | 'tag'

export type ColumnFilter =
  | { kind: 'search' }
  | { kind: 'status' }
  | { kind: 'node' }
  | { kind: 'choice'; param: FilterParam; values: readonly string[] }
  | { kind: 'dates'; after: FilterParam; before: FilterParam; presence?: FilterParam }
  | { kind: 'bytes'; over: FilterParam; under: FilterParam }

export type UserSort = 'username' | 'expireAt' | 'traffic' | 'lastOnline' | 'firstConnected' | 'lifetimeTraffic'

export interface UserColumn {
  id: ColumnId
  width: number
  sort?: UserSort
  filter?: ColumnFilter
  def?: true
}

// The standard layout fits the registry at 1440px. Manual widths may overflow.
export const COLUMNS: readonly UserColumn[] = [
  // Spare width belongs to the username column.
  { id: 'username', width: 182, sort: 'username', filter: { kind: 'search' }, def: true },
  { id: 'shortId', width: 64 },
  { id: 'status', width: 100, filter: { kind: 'status' }, def: true },
  { id: 'lastNode', width: 122, filter: { kind: 'node' }, def: true },
  { id: 'connection', width: 100, def: true },
  { id: 'expires', width: 140, sort: 'expireAt', filter: { kind: 'dates', after: 'expiresAfter', before: 'expiresBefore', presence: 'hasExpiry' }, def: true },
  { id: 'used', width: 138, sort: 'traffic', filter: { kind: 'bytes', over: 'usedOver', under: 'usedUnder' }, def: true },
  { id: 'usedPct', width: 48 },
  { id: 'limit', width: 76, filter: { kind: 'choice', param: 'trafficLimit', values: ['limited', 'unlimited'] }, def: true },
  { id: 'squads', width: 200 },
  { id: 'tag', width: 120, filter: { kind: 'choice', param: 'hasTag', values: ['yes', 'no'] } },
  { id: 'description', width: 220 },
  { id: 'telegramId', width: 150, filter: { kind: 'choice', param: 'telegram', values: ['linked', 'none'] } },
  { id: 'email', width: 220, filter: { kind: 'choice', param: 'email', values: ['set', 'none'] } },
  { id: 'subLink', width: 260 },
  { id: 'deviceLimit', width: 130, filter: { kind: 'choice', param: 'deviceLimit', values: ['set', 'unlimited', 'unset'] } },
  { id: 'firstConnected', width: 160, sort: 'firstConnected', filter: { kind: 'dates', after: 'firstConnectedAfter', before: 'firstConnectedBefore' } },
  { id: 'lastOnline', width: 154, sort: 'lastOnline' },
  { id: 'trafficReset', width: 160 },
  { id: 'lifetimeUsed', width: 150, sort: 'lifetimeTraffic' },
  { id: 'linkRevoked', width: 150, filter: { kind: 'choice', param: 'revoked', values: ['yes', 'no'] } },
  { id: 'created', width: 150, filter: { kind: 'dates', after: 'createdAfter', before: 'createdBefore' } },
  { id: 'uuid', width: 300 },
]

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]))

export type ColumnPin = 'left' | 'right'

export interface ColumnView {
  order: ColumnId[]
  hidden: ColumnId[]
  pins: Partial<Record<ColumnId, ColumnPin>>
  widths: Partial<Record<ColumnId, number>>
}

export const DEFAULT_VIEW: ColumnView = {
  order: COLUMNS.map(c => c.id),
  hidden: COLUMNS.filter((c) => !c.def).map((c) => c.id),
  pins: { username: 'left' },
  widths: {},
}

export const COLUMN_VIEW_KEY = 'iceslab:user-columns:v3'

export const parseStoredView = obj({ order: arr(str), hidden: arr(str), pins: record(nullable(str)), widths: record((v) => (typeof v === 'number' ? v : 0)) })

export function loadColumnView(): ColumnView {
  const current = readStored(COLUMN_VIEW_KEY, parseStoredView)
  if (current) return viewFromStored(current)
  const previous = readStored('iceslab:user-columns:v2', parseStoredView) ?? readStored('iceslab:user-columns', parseStoredView)
  if (!previous) return DEFAULT_VIEW
  // Only the exact defaults from the two published layouts advance automatically.
  const oldOrder = DEFAULT_VIEW.order.filter(id => id !== 'connection' || previous.order.includes('connection'))
  const oldHidden = DEFAULT_VIEW.hidden.filter(id => id !== 'shortId' && id !== 'usedPct')
  if (
    previous.order.length === oldOrder.length && oldOrder.every((id, i) => previous.order[i] === id) &&
    previous.hidden.length === oldHidden.length && oldHidden.every(id => previous.hidden.includes(id)) &&
    Object.keys(previous.widths).length === 0 &&
    Object.keys(previous.pins).length === 1 && previous.pins.username === 'left'
  ) return DEFAULT_VIEW
  return viewFromStored(previous)
}

const isColumn = (id: string): id is ColumnId => COLUMN_BY_ID.has(id as ColumnId)

/** Keep manual layouts when the registry gains the connection column. */
export function viewFromStored(stored: ReturnType<typeof parseStoredView> | null): ColumnView {
  if (!stored) return DEFAULT_VIEW
  const order = stored.order.filter(isColumn)
  const hidden = stored.hidden.filter(isColumn)
  if (!order.includes('connection')) {
    const node = order.indexOf('lastNode')
    if (node !== -1) order.splice(node + 1, 0, 'connection')
    if (node === -1 || hidden.includes('lastNode')) hidden.push('connection')
  }
  for (const column of COLUMNS) if (!order.includes(column.id)) order.push(column.id)
  const pins: ColumnView['pins'] = {}
  for (const [id, pin] of Object.entries(stored.pins)) if (isColumn(id) && (pin === 'left' || pin === 'right')) pins[id] = pin
  if (!stored.order.includes('connection') && pins.lastNode) pins.connection = pins.lastNode
  const widths: ColumnView['widths'] = {}
  for (const [id, width] of Object.entries(stored.widths)) if (isColumn(id) && width > 0) widths[id] = width
  return { order, hidden, pins, widths }
}

/** Left pins first and right pins last, the rest in the operator's order. */
export function visibleColumns(view: ColumnView): UserColumn[] {
  const shown = view.order.filter((id) => !view.hidden.includes(id)).flatMap((id) => {
    const column = COLUMN_BY_ID.get(id)
    return column ? [column] : []
  })
  const of = (pin: ColumnPin | undefined) => shown.filter((c) => view.pins[c.id] === pin)
  return [...of('left'), ...of(undefined), ...of('right')]
}

export const widthOf = (column: UserColumn, view: ColumnView) => view.widths[column.id] ?? column.width

export function filterKeys(filter: ColumnFilter | undefined): FilterParam[] {
  switch (filter?.kind) {
    case 'node':
      return ['nodeId', 'online']
    case 'choice':
      return [filter.param]
    case 'dates':
      return filter.presence ? [filter.after, filter.before, filter.presence] : [filter.after, filter.before]
    case 'bytes':
      return [filter.over, filter.under]
    case 'search':
    case 'status':
    case undefined:
      return []
  }
}
