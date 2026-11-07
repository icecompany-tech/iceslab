/**
 * What a screen that waits for one query shows (A-141).
 *
 * Data first: a refetch that fails after a good answer keeps the screen on
 * what it had. No data and a failed request is «failed», said with the
 * server's words and a retry: it used to read «loading» forever, or «there is
 * none», which is a different fact about a list that did not arrive.
 */
export type LoadView = 'ready' | 'failed' | 'loading';

export function loadView(q: { data: unknown; isError: boolean }): LoadView {
  if (q.data !== undefined && q.data !== null) return 'ready';
  return q.isError ? 'failed' : 'loading';
}

/**
 * A side list of a form (a selector's options, a status rail) that did not
 * arrive: the words to say and the retry, or null while it is fine or still
 * on its way. The form around it stays usable; only the part it feeds says it
 * failed, instead of looking empty. `say` turns the error into words, so this
 * file stays free of the network layer.
 */
export type LoadFailure = { message: string; onRetry: () => void };

export function loadFailure(
  q: { data: unknown; isError: boolean; error: unknown; refetch: () => unknown },
  say: (err: unknown) => string,
): LoadFailure | null {
  if (loadView(q) !== 'failed') return null;
  return { message: say(q.error), onRetry: () => void q.refetch() };
}

/**
 * The gate of an edit screen: the list that holds the item, whether the item
 * is in it, and the lists the form needs besides. «Gone» is said only when the
 * list ARRIVED and the item is not in it; a failed or pending list, or a
 * failed side list, is said as itself (A-141: the cascade screen called a live
 * cascade gone when the node list had failed). `failed` carries the index of
 * the query that failed: 0 is the main list, 1.. the others in order.
 */
export type GateView = { kind: 'ready' } | { kind: 'loading' } | { kind: 'gone' } | { kind: 'failed'; index: number };

export function editGate(
  main: { data: unknown; isError: boolean },
  found: boolean,
  others: { data: unknown; isError: boolean }[] = [],
): GateView {
  const m = loadView(main);
  if (m === 'failed') return { kind: 'failed', index: 0 };
  if (m === 'loading') return { kind: 'loading' };
  if (!found) return { kind: 'gone' };
  const failed = others.findIndex((q) => loadView(q) === 'failed');
  if (failed !== -1) return { kind: 'failed', index: failed + 1 };
  return others.every((q) => loadView(q) === 'ready') ? { kind: 'ready' } : { kind: 'loading' };
}
