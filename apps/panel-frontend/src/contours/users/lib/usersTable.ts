import type { UserFilters, UserSort } from '@/lib/domain/users';

/**
 * Every column the user list can show, in the order the column panel lists
 * them. Eight are on by default, which is what the view-state line counts;
 * the rest are there for the day an operator needs them and are reached
 * through the panel rather than by widening the table until it is unreadable.
 *
 * `sort` names the server-side sort a column drives, when there is one.
 * `filter` says what the list endpoint can narrow by: the header input is live
 * for those and disabled for the rest, because filtering a page of 25 out of
 * ten thousand in the browser would answer a different question than the one
 * being asked.
 */
export type UserColumnId =
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
  | 'routing'
  | 'deviceLimit'
  | 'firstConnected'
  | 'lastOnline'
  | 'trafficReset'
  | 'lifetimeUsed'
  | 'linkRevoked'
  | 'created'
  | 'uuid';

/**
 * What the header under a column offers, and what it sends.
 *
 * Every entry below corresponds to a parameter GET /api/users actually
 * answers to. Nothing is invented: a filter the server cannot honour would
 * return the whole list and look like it worked, which is the failure mode
 * this shape exists to make impossible. `usedPct` has no entry and will not
 * get one until the server can narrow by it.
 */
export type ColumnFilter =
  /** The list's own `search`, which also matches shortId and an exact telegramId. */
  | { kind: 'search' }
  /** The four status chips, already wired to `status`. */
  | { kind: 'status' }
  /** Which node they were last seen on, plus whether they are on it now. */
  | { kind: 'node' }
  /**
   * One select whose values ARE the parameter's values, copied from the
   * server's enum. There is deliberately no boolean kind: seven of these read
   * like yes/no questions and every one of them has its own pair of words.
   */
  | { kind: 'choice'; param: keyof UserFilters; values: string[] }
  /** Two dates, either of which may be left empty. `presence` adds the
   *  has-it-at-all question above them, where the field is nullable.
   *  `note` is an i18n key printed under the pair: a date filter silently drops
   *  every row whose value is null, and where that is a large share of the
   *  list the operator has to be told, or a filter that answered a narrower
   *  question than the one asked looks like a complete answer. */
  | {
      kind: 'dates';
      after: keyof UserFilters;
      before: keyof UserFilters;
      presence?: keyof UserFilters;
      note?: string;
    }
  /** Two sizes in GB, converted to bytes on the way out. */
  | { kind: 'bytes'; over: keyof UserFilters; under: keyof UserFilters };

export interface UserColumn {
  id: UserColumnId;
  /** i18n key under `users.table`. */
  label: string;
  /** Fixed px, or null for the one column that takes the slack. */
  width: number | null;
  sort?: UserSort;
  filter?: ColumnFilter;
  /** Shown before the operator touches the column panel. */
  def?: true;
}

export const USER_COLUMNS: UserColumn[] = [
  { id: 'username', label: 'username', width: null, sort: 'username', filter: { kind: 'search' }, def: true },
  { id: 'shortId', label: 'shortId', width: 104, def: true },
  { id: 'status', label: 'status', width: 132, filter: { kind: 'status' }, def: true },
  { id: 'lastNode', label: 'lastNode', width: 196, filter: { kind: 'node' }, def: true },
  {
    id: 'expires',
    label: 'expires',
    width: 172,
    sort: 'expireAt',
    filter: {
      kind: 'dates',
      after: 'expiresAfter',
      before: 'expiresBefore',
      presence: 'hasExpiry',
    },
    def: true,
  },
  {
    id: 'used',
    label: 'used',
    width: 248,
    sort: 'traffic',
    filter: { kind: 'bytes', over: 'usedOver', under: 'usedUnder' },
    def: true,
  },
  // No filter on purpose: the server cannot narrow by a percentage, and doing
  // it over one page of a paged list would answer a different question.
  { id: 'usedPct', label: 'usedPct', width: 124, def: true },
  {
    id: 'limit',
    label: 'limit',
    width: 140,
    filter: { kind: 'choice', param: 'trafficLimit', values: ['limited', 'unlimited'] },
    def: true,
  },
  { id: 'squads', label: 'squads', width: 200 },
  { id: 'tag', label: 'tag', width: 120, filter: { kind: 'choice', param: 'hasTag', values: ['yes', 'no'] } },
  { id: 'description', label: 'description', width: 220 },
  { id: 'telegramId', label: 'telegramId', width: 150, filter: { kind: 'choice', param: 'telegram', values: ['linked', 'none'] } },
  { id: 'email', label: 'email', width: 220, filter: { kind: 'choice', param: 'email', values: ['set', 'none'] } },
  { id: 'subLink', label: 'subLink', width: 260 },
  { id: 'routing', label: 'routing', width: 150 },
  {
    id: 'deviceLimit',
    label: 'deviceLimit',
    width: 130,
    filter: { kind: 'choice', param: 'deviceLimit', values: ['set', 'unset'] },
  },
  {
    id: 'firstConnected',
    label: 'firstConnected',
    width: 160,
    sort: 'firstConnected',
    filter: {
      kind: 'dates',
      after: 'firstConnectedAfter',
      before: 'firstConnectedBefore',
      note: 'usersTable.filterFirstConnectedNote',
    },
  },
  { id: 'lastOnline', label: 'lastOnline', width: 150, sort: 'lastOnline' },
  { id: 'trafficReset', label: 'trafficReset', width: 160 },
  { id: 'lifetimeUsed', label: 'lifetimeUsed', width: 150, sort: 'lifetimeTraffic' },
  { id: 'linkRevoked', label: 'linkRevoked', width: 150, filter: { kind: 'choice', param: 'revoked', values: ['yes', 'no'] } },
  {
    id: 'created',
    label: 'created',
    width: 150,
    filter: { kind: 'dates', after: 'createdAfter', before: 'createdBefore' },
  },
  { id: 'uuid', label: 'uuid', width: 300 },
];

export const USER_COLUMN_BY_ID = new Map(USER_COLUMNS.map((c) => [c.id, c]));

/**
 * Which request parameters a descriptor owns.
 *
 * Used for both "is this column narrowed" and "clear it", so the two can never
 * disagree about which keys belong to which heading. Lives here rather than
 * next to the popover: a file that exports components exports only components,
 * and this is a pure function over the model above.
 */
export function filterKeys(filter: ColumnFilter): (keyof UserFilters)[] {
  switch (filter.kind) {
    case 'node':
      return ['nodeId', 'online'];
    case 'choice':
      return [filter.param];
    case 'dates':
      return filter.presence
        ? [filter.after, filter.before, filter.presence]
        : [filter.after, filter.before];
    case 'bytes':
      return [filter.over, filter.under];
    default:
      return [];
  }
}

/** Where a column is nailed while the table scrolls sideways. */
export type ColumnPin = 'left' | 'right' | null;

export interface ColumnView {
  /** Column ids in display order. Holds every column, hidden ones included. */
  order: UserColumnId[];
  hidden: UserColumnId[];
  pins: Partial<Record<UserColumnId, ColumnPin>>;
}

export const DEFAULT_COLUMN_VIEW: ColumnView = {
  order: USER_COLUMNS.map((c) => c.id),
  hidden: USER_COLUMNS.filter((c) => !c.def).map((c) => c.id),
  pins: {},
};

/**
 * Kept per browser, like the user presets: which columns an operator wants is
 * personal muscle memory, and the panel has no table to store it in.
 */
export const COLUMN_VIEW_STORAGE_KEY = 'iceslab:user-columns';

export function loadColumnView(): ColumnView {
  try {
    const raw = localStorage.getItem(COLUMN_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMN_VIEW;
    const saved = JSON.parse(raw) as Partial<ColumnView>;
    const known = new Set(USER_COLUMNS.map((c) => c.id));
    // A column added since the view was saved has to appear, and one removed
    // has to drop out, otherwise a stale key would blank the table.
    const order = (saved.order ?? []).filter((id) => known.has(id));
    for (const c of USER_COLUMNS) if (!order.includes(c.id)) order.push(c.id);
    return {
      order,
      hidden: (saved.hidden ?? []).filter((id) => known.has(id)),
      pins: saved.pins ?? {},
    };
  } catch {
    return DEFAULT_COLUMN_VIEW;
  }
}

export function saveColumnView(view: ColumnView): void {
  try {
    localStorage.setItem(COLUMN_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // A browser with storage off still gets a working table for this session.
  }
}

/** The selection gutter and the trailing actions cell, neither of them data. */
export const SELECT_COL = 44;
export const ACTIONS_COL = 44;

/**
 * How much air a row gets. One button cycles the three, because the choice is
 * "more rows" against "easier to read" and an operator settles it by looking,
 * not by opening a settings page.
 */
export type RowDensity = 'compact' | 'normal' | 'relaxed';

export const DENSITY_ORDER: RowDensity[] = ['compact', 'normal', 'relaxed'];

/** Vertical padding of a cell, in px. Column widths never change with it. */
export const DENSITY_PADDING: Record<RowDensity, number> = {
  compact: 6,
  normal: 11,
  relaxed: 20,
};

export const DENSITY_STORAGE_KEY = 'iceslab:user-density';

export function loadDensity(): RowDensity {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY);
    return DENSITY_ORDER.includes(raw as RowDensity) ? (raw as RowDensity) : 'normal';
  } catch {
    return 'normal';
  }
}
