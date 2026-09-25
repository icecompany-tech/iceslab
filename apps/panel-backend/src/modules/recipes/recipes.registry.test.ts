import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeSource } from '@iceslab/shared';

/**
 * GET /api/recipes/registry says per source WHY a fetch failed.
 *
 * The default source points at a repository that does not exist yet (404 on
 * 2026-09-24), and the response said only `stale`, which the screen turned
 * into "unreachable": the operator went to check a network that was fine. A
 * 404 is `not-found`; no answer or a 5xx is `unreachable`.
 *
 * The sources are mocked (they live in the database) and fetch is stubbed, so
 * this is the classification and the response shape, not the network.
 */

const SOURCES: RecipeSource[] = [
  { id: 'default', name: 'official', url: 'https://example.com/missing/index.json', enabled: true, trusted: true, createdAt: '', updatedAt: '' },
  { id: 'down', name: 'down', url: 'https://example.com/down/index.json', enabled: true, trusted: false, createdAt: '', updatedAt: '' },
  { id: 'dns', name: 'dns', url: 'https://example.com/dns/index.json', enabled: true, trusted: false, createdAt: '', updatedAt: '' },
  { id: 'junk', name: 'junk', url: 'https://example.com/junk/index.json', enabled: true, trusted: false, createdAt: '', updatedAt: '' },
  { id: 'good', name: 'good', url: 'https://example.com/good/index.json', enabled: true, trusted: false, createdAt: '', updatedAt: '' },
];

vi.mock('./recipes.sources.js', () => ({
  getEnabledSources: async () => SOURCES,
}));
// The operator's own and hidden live in the database; none here, so this file
// stays about the sources whatever an earlier file left behind.
vi.mock('./recipes.mine.js', () => ({
  listOperatorRecipes: async () => [],
  getHiddenIds: async () => [],
}));

const { getRecipeRegistry, bustSourceCache, sourceProblem, RecipeFetchError } = await import('./recipes.registry.js');
const { getRecipeSnapshot } = await import('./recipes.snapshot.js');

function answer(url: string): Response {
  if (url.includes('/missing/')) return new Response('404: Not Found', { status: 404 });
  if (url.includes('/down/')) return new Response('bad gateway', { status: 502 });
  if (url.includes('/dns/')) throw new TypeError('fetch failed'); // what undici throws on DNS / refused
  if (url.includes('/junk/')) return new Response('<html>not json</html>', { status: 200 });
  return new Response(JSON.stringify([]), { status: 200 });
}

beforeEach(() => {
  bustSourceCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => answer(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recipe registry: why a source failed', () => {
  it('tells a 404 from an unreachable source, per source', async () => {
    const res = await getRecipeRegistry();
    expect(res.stale).toBe(true);
    const by = Object.fromEntries(res.sources.map((s) => [s.id, s]));
    expect(by.default).toEqual({ id: 'default', name: 'official', ok: false, reason: 'not-found', httpStatus: 404 });
    expect(by.down).toEqual({ id: 'down', name: 'down', ok: false, reason: 'unreachable', httpStatus: 502 });
    expect(by.dns).toEqual({ id: 'dns', name: 'dns', ok: false, reason: 'unreachable' });
    expect(by.junk).toMatchObject({ ok: false, reason: 'invalid' });
    expect(by.good).toEqual({ id: 'good', name: 'good', ok: true });
  });

  it('says the same from the negative cache, without fetching again', async () => {
    await getRecipeRegistry();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const again = await getRecipeRegistry();
    // Only the good source is cached as ok and within TTL; the failed ones are
    // inside the negative TTL: no source is fetched twice.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(again.sources.find((s) => s.id === 'default')).toMatchObject({ reason: 'not-found', httpStatus: 404 });
  });

  it('is not stale when every source answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const res = await getRecipeRegistry();
    expect(res.stale).toBe(false);
    expect(res.sources.every((s) => s.ok && s.reason === undefined)).toBe(true);
  });
});

describe('the pinned snapshot under the sources (25.09)', () => {
  const snapshotIds = () => getRecipeSnapshot().recipes.map((r) => r.id).sort();

  it('with every source down, the operator has exactly the snapshot, and the statuses say why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));
    const res = await getRecipeRegistry();
    expect(res.recipes.map((r) => r.id).sort()).toEqual(snapshotIds());
    expect(res.recipes.every((r) => r.sourceId === 'builtin' && r.sourceName === 'builtin')).toBe(true);
    expect(res.stale).toBe(true);
    expect(res.sources.every((s) => !s.ok)).toBe(true);
  });

  it('one recipe per id: a source wins over the snapshot, which is named in alsoIn', async () => {
    const snap = getRecipeSnapshot().recipes.find((r) => r.id === 'hysteria-default')!;
    const fromSource = { ...snap, name: 'Hysteria, as the registry says today' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/good/') || url.includes('/missing/')
          ? new Response(JSON.stringify([fromSource]), { status: 200 })
          : new Response('[]', { status: 200 }),
      ),
    );
    const res = await getRecipeRegistry();
    const hy = res.recipes.filter((r) => r.id === 'hysteria-default');
    expect(hy).toHaveLength(1);
    // The first source of the list wins; the later one and the snapshot are named.
    expect(hy[0]).toMatchObject({
      name: 'Hysteria, as the registry says today',
      sourceId: 'default',
      alsoIn: ['good', 'builtin'],
    });
    expect(res.recipes.map((r) => r.id).sort()).toEqual(snapshotIds());
  });
});

describe('sourceProblem', () => {
  it('reads the reason off the error, network failures are unreachable', () => {
    expect(sourceProblem(new RecipeFetchError('x', 'not-found', 404))).toEqual({ reason: 'not-found', httpStatus: 404 });
    expect(sourceProblem(new SyntaxError('Unexpected token'))).toEqual({ reason: 'invalid' });
    expect(sourceProblem(new TypeError('fetch failed'))).toEqual({ reason: 'unreachable' });
    expect(sourceProblem(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toEqual({ reason: 'unreachable' });
  });
});
