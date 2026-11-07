import { loadView, type LoadView } from '@/lib/old/loadView';

/**
 * Two readings of the Delivery page (A-233), out of the markup so a test holds
 * them.
 *
 * How many live subscriptions are handed out on the current address: a
 * number only when the server said one. A missing count is «unknown», not
 * «nobody»: it used to read as 0, and the warning before a host change went
 * quiet exactly when nothing was known.
 */
export function activeCountOf(settings: { subscriptionActiveCount?: unknown } | undefined): number | null {
  const n = settings?.subscriptionActiveCount;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The preview frame: a link to show, the request still on its way, or a
 * request that failed (said with a retry instead of «Loading…» forever). An
 * answer without a link is a failure too: there is nothing to show.
 */
export function previewView(q: { data: { url?: unknown } | undefined; isError: boolean }): LoadView {
  if (typeof q.data?.url === 'string' && q.data.url !== '') return 'ready';
  if (q.data !== undefined) return 'failed';
  return loadView(q);
}
