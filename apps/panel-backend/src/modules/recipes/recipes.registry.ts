import type { Recipe, RecipeRegistryResponse } from '@iceslab/shared';
import { isNewer, readCurrentVersion } from '../system/system.service.js';
import { parseRecipe, RegistryIndexSchema } from './recipes.schemas.js';

/**
 * Community transport-recipe registry, fetched from a public GitHub repo.
 *
 * Same best-effort contract as the version check (system.service.ts): the
 * panel must never break because GitHub is unreachable. On any failure we
 * fall back to the last good cache and flag it `stale`; if there is no cache
 * we return an empty list. Built-in recipes ship in the frontend, so the
 * registry being offline only hides the community set, never the essentials.
 *
 * A recipe is data, not code: it only carries ProfileForm field values.
 * Every entry is schema-validated (recipes.schemas.ts) before it is served,
 * and the created profile is still validated server-side on save.
 */

// Public raw URL of the registry index. Override for forks / mirrors.
const REGISTRY_URL =
  process.env.RECIPES_REGISTRY_URL ??
  'https://raw.githubusercontent.com/icecompany-tech/iceslab-recipes/main/index.json';
// Human-readable provenance echoed in the response.
const REGISTRY_SOURCE =
  process.env.RECIPES_REGISTRY_SOURCE ?? 'icecompany-tech/iceslab-recipes@main';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-fetch at most every 6h
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 1_000_000; // hard cap on the index payload we will parse

interface RegistryCache {
  recipes: Recipe[];
  fetchedAt: number; // epoch ms of the last SUCCESSFUL fetch
  ok: boolean; // did the most recent fetch attempt succeed
}
let cache: RegistryCache | null = null;
let inflight: Promise<RegistryCache> | null = null;

/**
 * Hide recipes the running panel is too old to honour: a recipe may set a
 * field that only exists in a newer panel, and applying it would silently
 * do nothing (or mislead). `minPanelVersion` absent means "any version".
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

async function fetchRegistry(): Promise<RegistryCache> {
  const prev = cache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(REGISTRY_URL, {
        headers: { Accept: 'application/json', 'User-Agent': 'iceslab-panel' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);

    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('registry payload too large');
    const payload: unknown = JSON.parse(text);

    const current = readCurrentVersion();
    const recipes: Recipe[] = [];
    const seen = new Set<string>();
    for (const raw of extractRawList(payload)) {
      const recipe = parseRecipe(raw);
      if (!recipe) continue; // malformed or unknown schemaVersion
      if (seen.has(recipe.id)) continue; // first id wins
      if (!versionAllows(recipe, current)) continue;
      seen.add(recipe.id);
      recipes.push(recipe);
    }
    return { recipes, fetchedAt: Date.now(), ok: true };
  } catch {
    // Keep serving the last good set, just flagged stale. Preserve its
    // fetchedAt so the UI can show how old the cache is.
    return {
      recipes: prev?.recipes ?? [],
      fetchedAt: prev?.fetchedAt ?? 0,
      ok: false,
    };
  }
}

async function getRegistry(): Promise<RegistryCache> {
  if (cache?.ok && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  // Single-flight: collapse concurrent refreshes into one GitHub call.
  if (!inflight) {
    inflight = fetchRegistry().then((r) => {
      // Only overwrite the cache on success, so a transient GitHub blip
      // does not evict a good set; a failed attempt just returns stale.
      if (r.ok || !cache) cache = r;
      inflight = null;
      return r.ok ? r : (cache ?? r);
    });
  }
  return inflight;
}

export interface RecipeRegistryFilters {
  protocol?: string;
  region?: string;
}

export async function getRecipeRegistry(
  filters: RecipeRegistryFilters = {},
): Promise<RecipeRegistryResponse> {
  const reg = await getRegistry();
  let recipes = reg.recipes;
  if (filters.protocol) {
    recipes = recipes.filter((r) => r.protocol === filters.protocol);
  }
  if (filters.region) {
    recipes = recipes.filter((r) => (r.region ?? 'GLOBAL') === filters.region);
  }
  return {
    fetchedAt: reg.fetchedAt ? new Date(reg.fetchedAt).toISOString() : '',
    source: REGISTRY_SOURCE,
    recipes,
    stale: !reg.ok,
  };
}
