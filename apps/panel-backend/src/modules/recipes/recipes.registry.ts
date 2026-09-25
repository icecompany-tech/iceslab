import type {
  Recipe,
  RecipeRegistryResponse,
  RecipeSource,
  RecipeSourceProblem,
  RecipeSourceStatus,
} from '@iceslab/shared';
import { RECIPE_SCHEMA_VERSION, RECIPE_SOURCE_BUILTIN } from '@iceslab/shared';
import { isNewer, readCurrentVersion } from '../system/system.service.js';
import { getRecipeSnapshot } from './recipes.snapshot.js';
import { getHiddenIds, listOperatorRecipes } from './recipes.mine.js';
import { parseRecipe, RecipeSchema, RegistryIndexSchema } from './recipes.schemas.js';
import { getEnabledSources } from './recipes.sources.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

/**
 * Community transport-recipe registry: recipes merged from every source the
 * operator has enabled (their own GitHub repos plus the curated default) over
 * the pinned snapshot of the public registry the panel ships (25.09: the
 * panel has no recipes of its own), one recipe per id.
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

/**
 * The raw recipe list a payload carries, and what it is: a registry (an index
 * object with `recipes`, or a bare array), one recipe (an object that says it
 * is one: `schemaVersion` or `id`, the form a single file in a registry
 * repository has), or neither.
 */
function extractRawList(payload: unknown): { raws: unknown[]; shape: 'list' | 'single' | 'none' } {
  const parsed = RegistryIndexSchema.safeParse(payload);
  if (parsed.success) return { raws: Array.isArray(parsed.data) ? parsed.data : parsed.data.recipes, shape: 'list' };
  if (payload && typeof payload === 'object' && ('schemaVersion' in payload || 'id' in payload)) {
    return { raws: [payload], shape: 'single' };
  }
  return { raws: [], shape: 'none' };
}

/** Why one raw entry is not served, in the words the import answers with. */
function recipeProblem(raw: unknown, index: number, current: string): string | null {
  const id = (raw as { id?: unknown } | null)?.id;
  const name = `recipe ${typeof id === 'string' ? id : `#${index + 1}`}`;
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 1) return `${name}: recipe schemaVersion 1 is not read any more, see the registry README`;
  const res = RecipeSchema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0]!;
    return `${name}: ${issue.path.join('.') || '(root)'}: ${issue.message}`;
  }
  if (res.data.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    return `${name}: schemaVersion ${res.data.schemaVersion}, this panel reads ${RECIPE_SCHEMA_VERSION}`;
  }
  if (!versionAllows(res.data as Recipe, current)) {
    return `${name}: needs panel ${res.data.minPanelVersion}, this one is ${current}`;
  }
  return null;
}

export interface ReadRecipes {
  /** What passed the schema and the version gate, deduped by id. */
  recipes: Recipe[];
  /** Why each other entry was left out, in words, in the order they came. */
  problems: string[];
  /** How many entries the payload carried at all. */
  total: number;
  shape: 'list' | 'single' | 'none';
}

/**
 * Validate + version-gate a parsed payload (registry index, bare array or one
 * recipe) into typed recipes, deduped by id, saying why each rejected entry
 * was rejected. Pure, so it backs the source fetch and the import alike.
 */
export function readRecipes(payload: unknown): ReadRecipes {
  const current = readCurrentVersion();
  const { raws, shape } = extractRawList(payload);
  const recipes: Recipe[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  raws.forEach((raw, i) => {
    const problem = recipeProblem(raw, i, current);
    if (problem) return void problems.push(problem);
    const recipe = parseRecipe(raw)!;
    if (seen.has(recipe.id)) return; // first id wins
    seen.add(recipe.id);
    recipes.push(recipe);
  });
  return { recipes, problems, total: raws.length, shape };
}

/** The recipes of a payload, the rejected ones dropped. */
export function parseRecipes(payload: unknown): Recipe[] {
  return readRecipes(payload).recipes;
}

/**
 * A source fetch that failed, with the reason the screen shows. Thrown where
 * the reason is known (the status line, the size cap, the redirect chain);
 * anything else a fetch throws is a network failure (see sourceProblem).
 */
export class RecipeFetchError extends Error {
  constructor(
    message: string,
    readonly reason: RecipeSourceProblem,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'RecipeFetchError';
  }
}

/**
 * Why a fetch failed. A 404 is its own answer: the default source points at a
 * repository that does not exist yet, and calling that "unreachable" sent the
 * operator to check their network. A body that is not JSON is `invalid`; a
 * throw from fetch itself (DNS, refused, reset, the abort timer) is
 * `unreachable`, and so is anything unrecognised, because it says "try
 * later" and claims nothing about the source.
 */
export function sourceProblem(err: unknown): { reason: RecipeSourceProblem; httpStatus?: number } {
  if (err instanceof RecipeFetchError) return { reason: err.reason, httpStatus: err.httpStatus };
  if (err instanceof SyntaxError) return { reason: 'invalid' }; // JSON.parse
  return { reason: 'unreachable' };
}

// Read a response body with a hard byte cap, streamed so an oversized or
// slow-drip body cannot buffer unbounded (the abort signal still bounds time).
async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) {
    throw new RecipeFetchError('source payload too large', 'invalid', res.status);
  }
  if (!res.body) {
    const t = await res.text();
    if (t.length > maxBytes) throw new RecipeFetchError('source payload too large', 'invalid', res.status);
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
      throw new RecipeFetchError('source payload too large', 'invalid', res.status);
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
async function fetchGuardedText(startUrl: string): Promise<{ text: string; contentType: string }> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validate the start URL and every redirect hop. A refusal keeps its
    // message (the import route shows it) and reads as `invalid`: the address,
    // not the network, is what is wrong.
    try {
      assertFetchableUrl(url);
    } catch (err) {
      throw new RecipeFetchError((err as Error).message, 'invalid');
    }
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
        if (!loc) throw new RecipeFetchError(`redirect ${res.status} without Location`, 'invalid', res.status);
        url = new URL(loc, url).toString(); // resolve relative, re-checked next hop
        continue;
      }
      if (!res.ok) {
        throw new RecipeFetchError(
          `source HTTP ${res.status}`,
          res.status === 404 ? 'not-found' : 'unreachable',
          res.status,
        );
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      return { text: await readBounded(res, MAX_BYTES), contentType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RecipeFetchError('too many redirects', 'invalid');
}

/**
 * The body of a link that is not JSON. Named by what the server said it is:
 * a GitHub file PAGE (text/html) is the usual case, and "no valid recipes"
 * about an HTML page sent the operator looking for a schema problem.
 */
export class RecipeNotJsonError extends SyntaxError {
  constructor(readonly contentType: string) {
    super(`the link does not answer with JSON (${contentType || 'no content-type'})`);
    this.name = 'RecipeNotJsonError';
  }
}

/**
 * Fetch + validate recipes from one URL. No caching, no source tagging;
 * used by the registry (wrapped in a cache) and the ad-hoc import route.
 * Throws on guard / network / size / redirect failure so the caller can 400
 * or fall back, and RecipeNotJsonError on a body that is not JSON.
 */
export async function fetchRecipesFromUrl(url: string): Promise<ReadRecipes> {
  const { text, contentType } = await fetchGuardedText(url);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RecipeNotJsonError(contentType);
  }
  return readRecipes(payload);
}

interface SourceCache {
  recipes: Recipe[];
  /** Why the entries left out of the last good fetch were left out. */
  problems?: string[];
  fetchedAt: number; // epoch ms of the last SUCCESSFUL fetch
  ok: boolean; // did the most recent attempt succeed
  failedAt?: number; // epoch ms of the last FAILED attempt (negative cache)
  reason?: RecipeSourceProblem; // why the most recent attempt failed
  httpStatus?: number; // what the source answered, if it answered
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
        const { recipes, problems } = await fetchRecipesFromUrl(source.url);
        const entry: SourceCache = { recipes, problems, fetchedAt: Date.now(), ok: true };
        cache.set(key, entry);
        return entry;
      } catch (err) {
        // Keep the last good set for this URL, flagged not-ok (stale), and
        // stamp failedAt so the negative cache above throttles retries. The
        // reason rides the cached entry, so a negative-cache hit says the same.
        const entry: SourceCache = {
          recipes: prev?.recipes ?? [],
          problems: prev?.problems,
          fetchedAt: prev?.fetchedAt ?? 0,
          ok: false,
          failedAt: Date.now(),
          ...sourceProblem(err),
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

/**
 * One recipe per id, the first in `candidates` winning; every later source
 * that carries the same id is named in the winner's `alsoIn`. Pure: the order
 * of `candidates` IS the precedence.
 */
export function mergeRecipesById(candidates: Recipe[]): Recipe[] {
  const byId = new Map<string, Recipe>();
  for (const r of candidates) {
    const winner = byId.get(r.id);
    if (!winner) {
      byId.set(r.id, { ...r });
      continue;
    }
    const name = r.sourceName ?? r.sourceId ?? '';
    if (name && name !== winner.sourceName && !(winner.alsoIn ?? []).includes(name)) {
      winner.alsoIn = [...(winner.alsoIn ?? []), name];
    }
  }
  return [...byId.values()];
}

/** The pinned snapshot's recipes, as the `builtin` source serves them. */
function snapshotRecipes(): Recipe[] {
  const current = readCurrentVersion();
  return getRecipeSnapshot()
    .recipes.filter((r) => versionAllows(r, current))
    .map((r) => ({
      ...r,
      sourceId: RECIPE_SOURCE_BUILTIN,
      sourceName: RECIPE_SOURCE_BUILTIN,
      // The snapshot's own stamp: the registry's build sets it, not the recipe.
      verified: r.verified === true,
    }));
}

export async function getRecipeRegistry(
  filters: RecipeRegistryFilters = {},
): Promise<RecipeRegistryResponse> {
  const sources = await getEnabledSources();
  const [results, mine, hiddenIds] = await Promise.all([
    Promise.all(sources.map(async (s) => ({ source: s, cache: await getSourceRecipes(s) }))),
    listOperatorRecipes(),
    getHiddenIds(),
  ]);

  let anyFailed = false;
  let latest = 0;
  const fromSources: Recipe[] = [];
  const statuses: RecipeSourceStatus[] = [];
  for (const { source, cache: c } of results) {
    if (!c.ok) anyFailed = true;
    // Entries a source carries and the panel cannot read (schema v1 above all)
    // are skipped and said, so an empty tile is not a mystery.
    const problems = c.problems && c.problems.length > 0 ? { problems: c.problems } : {};
    statuses.push(
      c.ok
        ? { id: source.id, name: source.name, ok: true, ...problems }
        : {
            id: source.id,
            name: source.name,
            ok: false,
            reason: c.reason ?? 'unreachable',
            ...(c.httpStatus !== undefined ? { httpStatus: c.httpStatus } : {}),
            ...problems,
          },
    );
    if (c.fetchedAt > latest) latest = c.fetchedAt;
    for (const r of c.recipes) {
      // Provenance + trust are the source's, not self-declared: a community
      // source cannot mark its recipes "official".
      fromSources.push({
        ...r,
        sourceId: source.id,
        sourceName: source.name,
        verified: source.trusted,
      });
    }
  }

  // The operator's own first, then their sources in the order of the list,
  // then the snapshot: the registry fetched today is newer than the one the
  // panel was built with. With every source down the operator has exactly the
  // snapshot and their own, and the statuses say which source failed.
  const current = readCurrentVersion();
  const merged = mergeRecipesById([...mine.filter((r) => versionAllows(r, current)), ...fromSources, ...snapshotRecipes()]);
  // Only ids a recipe has: a hidden id whose recipe is gone is not served.
  const liveIds = new Set(merged.map((r) => r.id));
  const hidden = hiddenIds.filter((id) => liveIds.has(id));
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
    sources: statuses,
    hidden,
  };
}

/** Every id the merged list has now: what the hidden list may name. */
export async function knownRecipeIds(): Promise<Set<string>> {
  return new Set((await getRecipeRegistry()).recipes.map((r) => r.id));
}
