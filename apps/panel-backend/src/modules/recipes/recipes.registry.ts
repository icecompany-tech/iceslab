import type { Recipe, RecipeRegistryResponse, RecipeSource } from '@iceslab/shared';
import { isNewer, readCurrentVersion } from '../system/system.service.js';
import { parseRecipe, RegistryIndexSchema } from './recipes.schemas.js';
import { getEnabledSources } from './recipes.sources.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

/**
 * Community transport-recipe registry: recipes merged from every source the
 * operator has enabled (their own GitHub repos plus the curated default).
 *
 * Same best-effort contract as the version check: the panel must never break
 * because a source is unreachable. Each source is fetched with a per-URL cache
 * (6h) and single-flight; a failing source falls back to its last good set and
 * flags the whole response `stale`, while the other sources still load. Recipes
 * are data, not code, they only carry ProfileForm field values, and every entry
 * is schema-validated before it is served.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // per source, re-fetch at most every 6h
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // don't re-hammer a dead source for 5 min
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 1_000_000; // hard cap on a single source payload
const MAX_REDIRECTS = 3;

/**
 * Hide recipes the running panel is too old to honour: a recipe may set a
 * field only a newer panel has. `minPanelVersion` absent means "any version".
 */
function versionAllows(recipe: Recipe, current: string): boolean {
  if (!recipe.minPanelVersion) return true;
  if (current === 'unknown') return true; // cannot compare, do not hide
  return !isNewer(recipe.minPanelVersion, current);
}

function extractRawList(payload: unknown): unknown[] {
  const parsed = RegistryIndexSchema.safeParse(payload);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.recipes;
}

/**
 * Validate + version-gate a parsed payload (registry index or bare array)
 * into typed recipes, deduped by id. Pure, so it also backs the pasted-JSON
 * import path.
 */
export function parseRecipes(payload: unknown): Recipe[] {
  const current = readCurrentVersion();
  const out: Recipe[] = [];
  const seen = new Set<string>();
  for (const raw of extractRawList(payload)) {
    const recipe = parseRecipe(raw);
    if (!recipe) continue; // malformed or unknown schemaVersion
    if (seen.has(recipe.id)) continue; // first id wins
    if (!versionAllows(recipe, current)) continue;
    seen.add(recipe.id);
    out.push(recipe);
  }
  return out;
}

// Read a response body with a hard byte cap, streamed so an oversized or
// slow-drip body cannot buffer unbounded (the abort signal still bounds time).
async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) {
    throw new Error('source payload too large');
  }
  if (!res.body) {
    const t = await res.text();
    if (t.length > maxBytes) throw new Error('source payload too large');
    return t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('source payload too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

/**
 * Fetch a URL's text with the SSRF guard re-run on EVERY hop. fetch is told
 * `redirect: 'manual'` so undici cannot silently follow a 3xx into a private
 * IP or metadata host; we resolve each Location ourselves and re-validate it.
 * The abort timer stays armed across the body read so a slow stream cannot
 * hang, and the body is size-capped while streaming.
 */
async function fetchGuardedText(startUrl: string): Promise<string> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertFetchableUrl(url); // re-validate the start URL and every redirect hop
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'iceslab-panel' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`redirect ${res.status} without Location`);
        url = new URL(loc, url).toString(); // resolve relative, re-checked next hop
        continue;
      }
      if (!res.ok) throw new Error(`source HTTP ${res.status}`);
      return await readBounded(res, MAX_BYTES);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('too many redirects');
}

/**
 * Fetch + validate recipes from one URL. No caching, no source tagging;
 * used by the registry (wrapped in a cache) and the ad-hoc import route.
 * Throws on guard / network / size / redirect failure so the caller can 400
 * or fall back.
 */
export async function fetchRecipesFromUrl(url: string): Promise<Recipe[]> {
  const text = await fetchGuardedText(url);
  return parseRecipes(JSON.parse(text) as unknown);
}

interface SourceCache {
  recipes: Recipe[];
  fetchedAt: number; // epoch ms of the last SUCCESSFUL fetch
  ok: boolean; // did the most recent attempt succeed
  failedAt?: number; // epoch ms of the last FAILED attempt (negative cache)
}
const cache = new Map<string, SourceCache>();
const inflight = new Map<string, Promise<SourceCache>>();

/**
 * Drop all cached source fetches. Called after any source add/update/delete so
 * a re-added or re-pointed source is re-fetched instead of serving a stale
 * URL-keyed hit (source mutations are rare, so busting everything is fine).
 */
export function bustSourceCache(): void {
  cache.clear();
  inflight.clear();
}

async function getSourceRecipes(source: RecipeSource): Promise<SourceCache> {
  const key = source.url;
  const hit = cache.get(key);
  if (hit?.ok && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  // Negative cache: a source that just failed is not re-hammered (and does not
  // block the merged response on its timeout) for NEGATIVE_TTL_MS.
  if (hit && !hit.ok && hit.failedAt && Date.now() - hit.failedAt < NEGATIVE_TTL_MS) {
    return hit;
  }
  let flight = inflight.get(key);
  if (!flight) {
    flight = (async () => {
      const prev = cache.get(key);
      try {
        const recipes = await fetchRecipesFromUrl(source.url);
        const entry: SourceCache = { recipes, fetchedAt: Date.now(), ok: true };
        cache.set(key, entry);
        return entry;
      } catch {
        // Keep the last good set for this URL, flagged not-ok (stale), and
        // stamp failedAt so the negative cache above throttles retries.
        const entry: SourceCache = {
          recipes: prev?.recipes ?? [],
          fetchedAt: prev?.fetchedAt ?? 0,
          ok: false,
          failedAt: Date.now(),
        };
        cache.set(key, entry);
        return entry;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, flight);
  }
  return flight;
}

export interface RecipeRegistryFilters {
  protocol?: string;
  region?: string;
}

export async function getRecipeRegistry(
  filters: RecipeRegistryFilters = {},
): Promise<RecipeRegistryResponse> {
  const sources = await getEnabledSources();
  const results = await Promise.all(
    sources.map(async (s) => ({ source: s, cache: await getSourceRecipes(s) })),
  );

  let anyFailed = false;
  let latest = 0;
  const merged: Recipe[] = [];
  const seen = new Set<string>(); // dedupe across sources by sourceId:id
  for (const { source, cache: c } of results) {
    if (!c.ok) anyFailed = true;
    if (c.fetchedAt > latest) latest = c.fetchedAt;
    for (const r of c.recipes) {
      const key = `${source.id}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Provenance + trust are the source's, not self-declared: a community
      // source cannot mark its recipes "official".
      merged.push({
        ...r,
        sourceId: source.id,
        sourceName: source.name,
        verified: source.trusted,
      });
    }
  }

  let recipes = merged;
  if (filters.protocol) {
    recipes = recipes.filter((r) => r.protocol === filters.protocol);
  }
  if (filters.region) {
    recipes = recipes.filter((r) => (r.region ?? 'GLOBAL') === filters.region);
  }

  return {
    fetchedAt: latest ? new Date(latest).toISOString() : '',
    source: sources.map((s) => s.name).join(', ') || 'none',
    recipes,
    stale: anyFailed,
  };
}
