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
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 1_000_000; // hard cap on a single source payload

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

/**
 * Fetch + validate recipes from one URL. No caching, no source tagging;
 * used by the registry (wrapped in a cache) and the ad-hoc import route.
 * Throws on guard / network / size failure so the caller can 400 or fall back.
 */
export async function fetchRecipesFromUrl(url: string): Promise<Recipe[]> {
  assertFetchableUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'iceslab-panel' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`source HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('source payload too large');
  return parseRecipes(JSON.parse(text) as unknown);
}

interface SourceCache {
  recipes: Recipe[];
  fetchedAt: number; // epoch ms of the last SUCCESSFUL fetch
  ok: boolean; // did the most recent attempt succeed
}
const cache = new Map<string, SourceCache>();
const inflight = new Map<string, Promise<SourceCache>>();

async function getSourceRecipes(source: RecipeSource): Promise<SourceCache> {
  const key = source.url;
  const hit = cache.get(key);
  if (hit?.ok && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
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
        // Keep the last good set for this URL, flagged not-ok (stale).
        const entry: SourceCache = {
          recipes: prev?.recipes ?? [],
          fetchedAt: prev?.fetchedAt ?? 0,
          ok: false,
        };
        if (!prev) cache.set(key, entry);
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
