import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eventBus, type DomainEventMap } from '../../lib/event-bus.js';
import {
  bindingsCacheKey,
  getCachedBindings,
  bustBindingsCache,
  registerBindingsCacheBust,
  _resetBindingsCacheForTest,
} from './subscription.bindings-cache.js';

describe('binding cache key (B6)', () => {
  it('is order-independent over the group set', () => {
    expect(bindingsCacheKey(['b', 'a', 'c'])).toBe(bindingsCacheKey(['c', 'b', 'a']));
  });
  it('distinguishes different sets', () => {
    expect(bindingsCacheKey(['a', 'b'])).not.toBe(bindingsCacheKey(['a']));
  });
});

describe('getCachedBindings (B6)', () => {
  beforeEach(() => _resetBindingsCacheForTest());

  it('runs the loader once, then serves from cache within TTL', async () => {
    let calls = 0;
    const load = () => {
      calls++;
      return Promise.resolve([calls]);
    };
    const a = await getCachedBindings('k', 1000, load);
    const b = await getCachedBindings('k', 1000, load);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]); // same cached value
    expect(calls).toBe(1);
  });

  it('reloads after the TTL window elapses', async () => {
    let calls = 0;
    const load = () => Promise.resolve([++calls]);
    await getCachedBindings('k', 1000, load);
    // 60s TTL -> still cached at +59s, reloaded at +61s
    await getCachedBindings('k', 1000 + 59_000, load);
    expect(calls).toBe(1);
    await getCachedBindings('k', 1000 + 61_000, load);
    expect(calls).toBe(2);
  });

  it('reloads immediately after a bust, even within TTL', async () => {
    let calls = 0;
    const load = () => Promise.resolve([++calls]);
    await getCachedBindings('k', 1000, load);
    bustBindingsCache();
    await getCachedBindings('k', 1000, load);
    expect(calls).toBe(2);
  });

  it('does not serve a value loaded before a concurrent bust', async () => {
    let resolveLoad: (v: number[]) => void = () => {};
    const slow = () =>
      new Promise<number[]>((res) => {
        resolveLoad = res;
      });
    const p = getCachedBindings('k', 1000, slow);
    // A config change lands while the query is in flight.
    bustBindingsCache();
    resolveLoad([1]);
    await p;
    // Next read must miss (the in-flight result was loaded under the old version).
    let reloaded = false;
    await getCachedBindings('k', 1000, () => {
      reloaded = true;
      return Promise.resolve([2]);
    });
    expect(reloaded).toBe(true);
  });

  it('single-flights concurrent misses on the same key', async () => {
    let calls = 0;
    const load = () =>
      new Promise<number[]>((res) => {
        calls++;
        setTimeout(() => res([calls]), 0);
      });
    const [a, b] = await Promise.all([
      getCachedBindings('k', 1000, load),
      getCachedBindings('k', 1000, load),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b); // same resolved reference
  });

  it('keeps separate entries per key', async () => {
    const a = await getCachedBindings('ka', 1000, () => Promise.resolve(['a']));
    const b = await getCachedBindings('kb', 1000, () => Promise.resolve(['b']));
    expect(a).toEqual(['a']);
    expect(b).toEqual(['b']);
  });
});

// The cached query spans bindings, profiles, nodes, hosts and the cascade
// exposure set. Any of those moving while the cache serves the old answer means
// an admin watches their edit do nothing for up to a minute, or worse, users
// keep dialling an address that no longer works. Each event below is one such
// mutation path, so this table is the list of edits that must take effect at
// once, and it should grow whenever a new one appears.
describe('registerBindingsCacheBust (M5)', () => {
  const MUTATIONS: { [K in keyof DomainEventMap]?: DomainEventMap[K] } = {
    'binding.created': { bindingId: 'b', profileId: 'p', nodeId: 'n' },
    'binding.updated': { bindingId: 'b', profileId: 'p', nodeId: 'n' },
    'binding.deleted': { bindingId: 'b', profileId: 'p', nodeId: 'n' },
    'profile.created': { profileId: 'p' },
    'profile.updated': { profileId: 'p' },
    'profile.deleted': { profileId: 'p', affectedNodeIds: ['n'] },
    'node.created': { nodeId: 'n', nodeName: 'n1' },
    'node.changed': { nodeId: 'n' },
    'node.deleted': { nodeId: 'n' },
    'host.changed': {},
    'cascade.changed': { nodeIds: ['n'] },
  };

  // Subscribed once: the bus has no unsubscribe, and re-registering per test
  // would just stack duplicate listeners.
  beforeAll(() => registerBindingsCacheBust());
  beforeEach(() => _resetBindingsCacheForTest());

  for (const [event, payload] of Object.entries(MUTATIONS)) {
    it(`busts on ${event}`, async () => {
      let calls = 0;
      const load = (): Promise<number[]> => Promise.resolve([++calls]);
      await getCachedBindings('k', 1000, load);

      eventBus.emit(event as keyof DomainEventMap, payload as never);
      // The bus defers handlers onto a microtask, so the bust is not visible
      // synchronously after emit.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Same key, same instant: only an invalidation can force a reload here.
      await getCachedBindings('k', 1000, load);
      expect(calls).toBe(2);
    });
  }
});
