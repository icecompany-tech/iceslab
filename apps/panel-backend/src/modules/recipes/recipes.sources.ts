import { randomUUID } from 'node:crypto';
import type { RecipeSource, RecipeSourceInput } from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

/**
 * Operator-managed recipe sources ("bring your own GitHub"). Stored as a JSON
 * array in the generic app_settings KV table, so no schema migration is
 * needed. The seeded default points at the curated iceslab-recipes registry;
 * it is returned only while the operator has never touched the list, so once
 * they edit it their choices (including removing the default) stick.
 */

const SETTINGS_KEY = 'recipeSources';

/** Stable id so the default source survives without ever being persisted. */
const DEFAULT_SOURCE_ID = 'default';

const DEFAULT_SOURCE: RecipeSource = {
  id: DEFAULT_SOURCE_ID,
  name: 'iceslab-recipes (official)',
  url:
    process.env.RECIPES_REGISTRY_URL ??
    'https://raw.githubusercontent.com/icecompany-tech/iceslab-recipes/main/index.json',
  enabled: true,
  trusted: true,
  createdAt: '',
  updatedAt: '',
};

/** Defensive parse of the stored JSON: drop anything not source-shaped. */
function coerceSources(value: unknown): RecipeSource[] {
  if (!Array.isArray(value)) return [DEFAULT_SOURCE];
  const out: RecipeSource[] = [];
  for (const v of value) {
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as Record<string, unknown>).id === 'string' &&
      typeof (v as Record<string, unknown>).url === 'string'
    ) {
      const s = v as Record<string, unknown>;
      out.push({
        id: String(s.id),
        name: typeof s.name === 'string' && s.name ? s.name : String(s.id),
        url: String(s.url),
        enabled: s.enabled !== false,
        trusted: s.trusted === true,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : '',
        updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
      });
    }
  }
  return out;
}

export async function getSources(): Promise<RecipeSource[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return [DEFAULT_SOURCE]; // untouched: offer the curated default
  return coerceSources(row.value);
}

export async function getEnabledSources(): Promise<RecipeSource[]> {
  return (await getSources()).filter((s) => s.enabled);
}

/**
 * Serialize a read-modify-write of the recipeSources blob. A transaction-scoped
 * advisory lock keyed on the settings key makes concurrent source mutations
 * (two admin tabs, a double-submit, an API script) apply one after another
 * instead of silently dropping each other (lost update on the shared blob).
 */
async function mutateSources<T>(
  apply: (sources: RecipeSource[]) => { next: RecipeSource[]; result: T },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETTINGS_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const current = row ? coerceSources(row.value) : [DEFAULT_SOURCE];
    const { next, result } = apply(current);
    const value = next as unknown as Prisma.InputJsonValue;
    await tx.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value, isPublic: false },
      update: { value },
    });
    return result;
  });
}

export async function addSource(input: RecipeSourceInput): Promise<RecipeSource> {
  assertFetchableUrl(input.url); // throws -> 400 in the route
  const now = new Date().toISOString();
  const source: RecipeSource = {
    id: randomUUID(),
    name: input.name.trim(),
    url: input.url.trim(),
    enabled: input.enabled ?? true,
    trusted: false,
    createdAt: now,
    updatedAt: now,
  };
  // Persisting [...sources] pins the (possibly virtual) default alongside the
  // new one so it does not silently vanish on first write.
  return mutateSources((sources) => ({ next: [...sources, source], result: source }));
}

export async function updateSource(
  id: string,
  patch: Partial<RecipeSourceInput>,
): Promise<RecipeSource | null> {
  if (patch.url !== undefined) assertFetchableUrl(patch.url);
  return mutateSources((sources) => {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx === -1) return { next: sources, result: null };
    const existing = sources[idx]!;
    const updated: RecipeSource = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      url: patch.url?.trim() ?? existing.url,
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: new Date().toISOString(),
    };
    const next = [...sources];
    next[idx] = updated;
    return { next, result: updated };
  });
}

export async function deleteSource(id: string): Promise<boolean> {
  return mutateSources((sources) => {
    const next = sources.filter((s) => s.id !== id);
    return { next, result: next.length !== sources.length };
  });
}
