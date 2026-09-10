import type { UserSort } from '@/lib/domain/users';

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

export interface UserColumn {
  id: UserColumnId;
  /** i18n key under `users.table`. */
  label: string;
  /** Fixed px, or null for the one column that takes the slack. */
  width: number | null;
  sort?: UserSort;
  filter?: 'search' | 'status';
  /** Shown before the operator touches the column panel. */
  def?: true;
}

export const USER_COLUMNS: UserColumn[] = [
  { id: 'username', label: 'username', width: null, sort: 'username', filter: 'search', def: true },
  { id: 'shortId', label: 'shortId', width: 104, def: true },
  { id: 'status', label: 'status', width: 132, filter: 'status', def: true },
  { id: 'lastNode', label: 'lastNode', width: 196, def: true },
  { id: 'expires', label: 'expires', width: 172, sort: 'expireAt', def: true },
  { id: 'used', label: 'used', width: 248, sort: 'traffic', def: true },
  { id: 'usedPct', label: 'usedPct', width: 124, def: true },
  { id: 'limit', label: 'limit', width: 140, def: true },
  { id: 'squads', label: 'squads', width: 200 },
  { id: 'tag', label: 'tag', width: 120 },
  { id: 'description', label: 'description', width: 220 },
  { id: 'telegramId', label: 'telegramId', width: 150 },
  { id: 'email', label: 'email', width: 220 },
  { id: 'subLink', label: 'subLink', width: 260 },
  { id: 'routing', label: 'routing', width: 150 },
  { id: 'deviceLimit', label: 'deviceLimit', width: 130 },
  { id: 'firstConnected', label: 'firstConnected', width: 160 },
  { id: 'lastOnline', label: 'lastOnline', width: 150 },
  { id: 'trafficReset', label: 'trafficReset', width: 160 },
  { id: 'lifetimeUsed', label: 'lifetimeUsed', width: 150 },
  { id: 'linkRevoked', label: 'linkRevoked', width: 150 },
  { id: 'created', label: 'created', width: 150 },
  { id: 'uuid', label: 'uuid', width: 300 },
];

export const USER_COLUMN_BY_ID = new Map(USER_COLUMNS.map((c) => [c.id, c]));

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
