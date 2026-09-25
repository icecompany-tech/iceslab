import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  RECIPE_SCHEMA_VERSION,
  RECIPES_REGISTRY,
  type Recipe,
  type RecipeSnapshot,
} from '@iceslab/shared';
import { RecipeSchema, RegistryIndexSchema } from './recipes.schemas.js';

/**
 * The pinned snapshot of the public recipe registry (owner's decision 25.09:
 * the panel ships no recipes of its own). Built by scripts/sync-recipes.ts
 * from RECIPES_REGISTRY, committed as packages/shared/src/recipes.snapshot.json,
 * served by GET /api/recipes/registry under the `builtin` source.
 *
 * Built all-or-nothing: a recipe the schema refuses stops the build with its
 * id and reason instead of being skipped, because a snapshot that silently
 * lost a recipe would ship that way.
 */

export class RecipeSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeSnapshotError';
  }
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The snapshot of one index.json, checked against the pin it claims to be. */
export function buildRecipeSnapshot(
  index: Uint8Array,
  pin: { repo: string; commit: string; indexSha256: string } = RECIPES_REGISTRY,
): RecipeSnapshot {
  const got = sha256Hex(index);
  if (got !== pin.indexSha256) {
    throw new RecipeSnapshotError(
      `index.json of ${pin.repo}@${pin.commit} has sha256 ${got}, the pin says ${pin.indexSha256}`,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(index));
  } catch (err) {
    throw new RecipeSnapshotError(`index.json of ${pin.repo}@${pin.commit} is not JSON: ${(err as Error).message}`);
  }
  const list = RegistryIndexSchema.safeParse(payload);
  if (!list.success) throw new RecipeSnapshotError(`index.json of ${pin.repo}@${pin.commit} is not a recipe registry`);
  const raws = Array.isArray(list.data) ? list.data : list.data.recipes;

  const recipes: Recipe[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of raws.entries()) {
    const res = RecipeSchema.safeParse(raw);
    const id = (raw as { id?: unknown })?.id;
    const name = typeof id === 'string' ? id : `#${i}`;
    if (!res.success) {
      const issue = res.error.issues[0]!;
      throw new RecipeSnapshotError(`recipe ${name}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    if (res.data.schemaVersion !== RECIPE_SCHEMA_VERSION) {
      throw new RecipeSnapshotError(`recipe ${name}: schemaVersion ${res.data.schemaVersion}, the panel reads ${RECIPE_SCHEMA_VERSION}`);
    }
    if (seen.has(res.data.id)) throw new RecipeSnapshotError(`recipe ${name} is in the index twice`);
    seen.add(res.data.id);
    recipes.push(res.data as Recipe);
  }
  return { repo: pin.repo, commit: pin.commit, indexSha256: pin.indexSha256, recipes };
}

/** The file's text: one form, so the build and the guard compare bytes. */
export function serializeRecipeSnapshot(snapshot: RecipeSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * Where the committed snapshot lives, resolved through the shared package:
 * beside its src/index.ts, which always exists (the snapshot itself may not,
 * the first time the build writes it).
 */
export function recipeSnapshotPath(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@iceslab/shared')), 'recipes.snapshot.json');
}

let cached: RecipeSnapshot | null = null;

/** The committed snapshot, read once. */
export function getRecipeSnapshot(): RecipeSnapshot {
  if (!cached) cached = JSON.parse(readFileSync(recipeSnapshotPath(), 'utf8')) as RecipeSnapshot;
  return cached;
}
