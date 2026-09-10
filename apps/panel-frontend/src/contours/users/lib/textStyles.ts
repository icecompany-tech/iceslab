import { MIST } from '@/contours/users/lib/colors';
export const DISPLAY = { fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" };
export const MONO = { fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" };
export const MONO_LABEL = {
  ...MONO,
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

/**
 * What the pill says about a user, in one word.
 *
 * A working subscription splits by presence, so "active" never reaches the
 * screen: it says ONLINE or OFFLINE instead. A word carries this better than a
 * mark did, which is why the dot beside the username is gone. What stays next
 * to it is the last-online column, and that is a different question: OFFLINE
 * covers both "28m ago" and "3 days ago", and an operator acts differently on
 * those two.
 *
 * PROBLEMS ARE CHECKED FIRST, and that order is the point. An expired, limited
 * or disabled user is pulled from every node, so they cannot be online except
 * for the couple of minutes right after the switch, while the five-minute
 * window has not run out. In those minutes the problem is what an operator
 * needs to see, not the tail of a connection that is already gone.
 */
