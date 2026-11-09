// Every column of the list. A filter exists only where GET /api/users narrows by it: a filter
// the server cannot honour would return the whole list and look like it worked.
import { arr, obj, record, str, nullable } from '@/lib/net/parse'

export type ColumnId =
  | 'username'
  | 'shortId'
  | 'status'
  | 'lastNode'
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

// Widths are the frame's: the table is drawn for sideways scrolling (design 2026-11-04).
export const COLUMNS: readonly UserColumn[] = [
  // «Юзер» is the least it takes: the 8 default columns sum to 1086 at 1440, a wider window adds to it.
  { id: 'username', width: 220, sort: 'username', filter: { kind: 'search' }, def: true },
  { id: 'shortId', width: 68, def: true },
  { id: 'status', width: 104, filter: { kind: 'status' }, def: true },
  { id: 'lastNode', width: 144, filter: { kind: 'node' }, def: true },
  { id: 'expires', width: 140, sort: 'expireAt', filter: { kind: 'dates', after: 'expiresAfter', before: 'expiresBefore', presence: 'hasExpiry' }, def: true },
  { id: 'used', width: 162, sort: 'traffic', filter: { kind: 'bytes', over: 'usedOver', under: 'usedUnder' }, def: true },
  { id: 'usedPct', width: 56, def: true },
  { id: 'limit', width: 76, filter: { kind: 'choice', param: 'trafficLimit', values: ['limited', 'unlimited'] }, def: true },
  { id: 'squads', width: 200 },
  { id: 'tag', width: 120, filter: { kind: 'choice', param: 'hasTag', values: ['yes', 'no'] } },
  { id: 'description', width: 220 },
  { id: 'telegramId', width: 150, filter: { kind: 'choice', param: 'telegram', values: ['linked', 'none'] } },
  { id: 'email', width: 220, filter: { kind: 'choice', param: 'email', values: ['set', 'none'] } },
  { id: 'subLink', width: 260 },
  { id: 'deviceLimit', width: 130, filter: { kind: 'choice', param: 'deviceLimit', values: ['set', 'unlimited', 'unset'] } },
  { id: 'firstConnected', width: 160, sort: 'firstConnected', filter: { kind: 'dates', after: 'firstConnectedAfter', before: 'firstConnectedBefore' } },
  { id: 'lastOnline', width: 150, sort: 'lastOnline' },
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
  order: COLUMNS.map((c) => c.id),
  hidden: COLUMNS.filter((c) => !c.def).map((c) => c.id),
  pins: { username: 'left' },
  widths: {},
}

export const COLUMN_VIEW_KEY = 'iceslab:user-columns'

export const parseStoredView = obj({ order: arr(str), hidden: arr(str), pins: record(nullable(str)), widths: record((v) => (typeof v === 'number' ? v : 0)) })

const isColumn = (id: string): id is ColumnId => COLUMN_BY_ID.has(id as ColumnId)

/** A column added since the view was saved appears, a removed one drops out. */
export function viewFromStored(stored: ReturnType<typeof parseStoredView> | null): ColumnView {
  if (!stored) return DEFAULT_VIEW
  const order = stored.order.filter(isColumn)
  for (const column of COLUMNS) if (!order.includes(column.id)) order.push(column.id)
  const pins: ColumnView['pins'] = {}
  for (const [id, pin] of Object.entries(stored.pins)) if (isColumn(id) && (pin === 'left' || pin === 'right')) pins[id] = pin
  const widths: ColumnView['widths'] = {}
  for (const [id, width] of Object.entries(stored.widths)) if (isColumn(id) && width > 0) widths[id] = width
  return { order, hidden: stored.hidden.filter(isColumn), pins, widths }
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
