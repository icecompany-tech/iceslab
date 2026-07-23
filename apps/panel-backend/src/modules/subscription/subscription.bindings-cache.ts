import { eventBus } from '../../lib/event-bus.js';

/**
 * B6 - in-process cache for the heavy per-`/sub` binding query (the nested
 * findMany over profile_node_bindings + profiles + nodes + hosts).
 *
 * Keyed by the user's SQUAD SET (sorted group ids), not per-user: every user
 * in the same squads resolves the identical binding set, so a single entry
 * serves them all and stays warm across their periodic refreshes. A user's
 * membership changing needs no invalidation - they simply map to a different
 * key on the next request.
 *
 * Invalidation:
 *  - A global version counter, bumped on every domain event that touches what
 *    the query reads (bindings, profiles, nodes, hosts, cascades), so an admin
 *    edit shows up on the next request rather than at the end of the TTL.
 *  - The TTL then only backstops what never reaches the bus at all: a row
 *    changed straight in the database, or an event a future mutation path
 *    forgets to emit.
 *
 * In-process (not Redis) on purpose: the cached value is the raw Prisma result
 * with nested objects and Date fields, so keeping it in-heap avoids a
 * serialize/revive round-trip (and the Date-revival bugs that invites) on the
 * hot path. The panel runs single-instance today; revisit if it ever scales
 * horizontally (then a Redis mirror or pub/sub bust would be needed).
 *
 * Callers MUST treat the returned array as read-only or shallow-copy it before
 * mutating - generateSubscription sorts and topN-filters in place, so it works
 * on `[...cached]`.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

let version = 0;

interface Entry<T> {
  /** Version the value was loaded under; stale once `version` moves past it. */
  version: number;
  expiresAt: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Stable cache key for a set of group ids (order-independent). */
export function bindingsCacheKey(groupIds: string[]): string {
  return [...groupIds].sort().join(',');
}

/** Invalidate every cached binding set (next read reloads). */
export function bustBindingsCache(): void {
  version++;
}

/**
 * Return the cached binding set for `key`, or run `loader` and cache it.
 * `nowMs` is injected (callers pass Date.now()) so the TTL is unit-testable.
 * Concurrent misses on the same key share one loader call (single-flight).
 */
export async function getCachedBindings<T>(
  key: string,
  nowMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.version === version && hit.expiresAt > nowMs) {
    return hit.value as T;
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  // Capture the version BEFORE loading. If a bust lands while the query is in
  // flight, the stored entry keeps the older version and the next read misses
  // - we never serve data loaded before a config change as if it were current.
  const loadedVersion = version;
  const p = (async () => {
    try {
      const value = await loader();
      // Bounded, insertion-order eviction (Map preserves insertion order, so
      // the first key is the oldest). Only evicts when inserting a new key.
      if (store.size >= MAX_ENTRIES && !store.has(key)) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { version: loadedVersion, expiresAt: nowMs + TTL_MS, value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p as Promise<T>;
}

/** Subscribe cache-busting to config-change domain events. Call once at boot. */
export function registerBindingsCacheBust(): void {
  const bust = (): void => bustBindingsCache();
  eventBus.on('binding.created', bust);
  eventBus.on('binding.updated', bust);
  eventBus.on('binding.deleted', bust);
  eventBus.on('profile.created', bust);
  eventBus.on('profile.updated', bust);
  eventBus.on('profile.deleted', bust);
  eventBus.on('node.created', bust);
  // Everything the cached query reads must bust it, or an admin's edit sits
  // invisible behind the TTL while they refresh the page wondering why. The
  // query spans bindings, profiles, nodes and hosts:
  //   node.changed    → any node edit, including the address a client dials
  //   node.deleted    → its endpoints must stop being served immediately
  //   host.changed    → per-binding endpoint override added/edited/reordered
  //   cascade.changed → hops came or went, which moves what is exposed
  eventBus.on('node.changed', bust);
  eventBus.on('node.deleted', bust);
  eventBus.on('host.changed', bust);
  eventBus.on('cascade.changed', bust);
}

// ───── Test seams ─────
export function _resetBindingsCacheForTest(): void {
  store.clear();
  inflight.clear();
  version = 0;
}
