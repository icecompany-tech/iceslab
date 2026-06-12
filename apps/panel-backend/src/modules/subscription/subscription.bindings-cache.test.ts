import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindingsCacheKey,
  getCachedBindings,
  bustBindingsCache,
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
