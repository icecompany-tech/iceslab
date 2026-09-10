import type { UserSort } from '@/lib/domain/users';

/**
 * The columns of the user list, in the order and at the widths the artboard
 * lays them out. Username is the only elastic one; everything to its right is
 * fixed so the lanes line up across every row on the page, and one long name
 * cannot shift the traffic bars of its own row alone.
 *
 * `sort` names the server-side sort this column drives, when there is one.
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
  | 'limit';

export interface UserColumn {
  id: UserColumnId;
  /** i18n key under `users.table`. */
  label: string;
  /** Fixed px, or null for the one column that takes the slack. */
  width: number | null;
  sort?: UserSort;
  filter?: 'search' | 'status';
}

export const USER_COLUMNS: UserColumn[] = [
  { id: 'username', label: 'username', width: null, sort: 'username', filter: 'search' },
  { id: 'shortId', label: 'shortId', width: 104 },
  { id: 'status', label: 'status', width: 132, filter: 'status' },
  { id: 'lastNode', label: 'lastNode', width: 196 },
  { id: 'expires', label: 'expires', width: 172, sort: 'expireAt' },
  { id: 'used', label: 'used', width: 248, sort: 'traffic' },
  { id: 'usedPct', label: 'usedPct', width: 124 },
  { id: 'limit', label: 'limit', width: 140 },
];

/**
 * How many columns the list could show against how many it does. The panel
 * carries more about a user than fits a screen, so the number is honest about
 * what is being left out rather than pretending eight is all there is.
 */
export const USER_COLUMNS_TOTAL = 23;

/** The selection gutter and the trailing actions cell, neither of them data. */
export const SELECT_COL = 44;
export const ACTIONS_COL = 44;
