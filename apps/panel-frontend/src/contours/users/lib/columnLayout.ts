import type { CSSProperties } from 'react';
import { ACTIONS_COL, SELECT_COL } from '@/contours/users/lib/usersTable';
import type { ColumnPin, UserColumn } from '@/contours/users/lib/usersTable';

/** A flexible column that gets nailed to an edge has to stop being flexible. */
const PINNED_FALLBACK_WIDTH = 384;

/**
 * Where each column sits while the table scrolls sideways.
 *
 * With twenty-three columns available the table is wider than any screen, so
 * the point of pinning is that the name stays readable while the numbers move
 * past it. That means real `position: sticky`, and sticky needs an offset: a
 * left-pinned column sits after the selection gutter and after every
 * left-pinned column before it, a right-pinned one mirrors that from the
 * actions gutter.
 */
export function columnStyles(
  columns: UserColumn[],
  pins: Partial<Record<string, ColumnPin>>,
  background: string,
): CSSProperties[] {
  const widthOf = (c: UserColumn) => c.width ?? PINNED_FALLBACK_WIDTH;

  let left = SELECT_COL;
  const lefts = new Map<string, number>();
  for (const c of columns) {
    if ((pins[c.id] ?? null) !== 'left') continue;
    lefts.set(c.id, left);
    left += widthOf(c);
  }

  let right = ACTIONS_COL;
  const rights = new Map<string, number>();
  for (const c of [...columns].reverse()) {
    if ((pins[c.id] ?? null) !== 'right') continue;
    rights.set(c.id, right);
    right += widthOf(c);
  }

  return columns.map((c) => {
    const pin = pins[c.id] ?? null;
    const base: CSSProperties =
      pin !== null || c.width !== null
        ? { width: widthOf(c), flexShrink: 0 }
        : { flex: 1, minWidth: 0 };
    if (pin === null) return base;
    return {
      ...base,
      position: 'sticky',
      ...(pin === 'left' ? { left: lefts.get(c.id) } : { right: rights.get(c.id) }),
      // Sticky cells slide over their neighbours, so they need a floor of
      // their own or the text underneath shows through.
      backgroundColor: background,
      zIndex: 2,
    };
  });
}
