/**
 * Build packages/shared/src/recipes.snapshot.json from the pinned registry
 * commit (RECIPES_REGISTRY in packages/shared/src/recipes-registry.ts):
 *
 *   pnpm --filter @iceslab/panel-backend sync:recipes
 *
 * Fetches index.json at the pinned commit, refuses it unless its sha256 is the
 * pinned one, validates every recipe with the panel's own schema, and writes
 * the snapshot. Run it after moving the pin and commit both files; the guard
 * test (recipes.snapshot.test.ts) is red until you do.
 */
import { writeFileSync } from 'node:fs';
import { RECIPES_REGISTRY, recipesRegistryIndexUrl } from '@iceslab/shared';
import {
  buildRecipeSnapshot,
  recipeSnapshotPath,
  serializeRecipeSnapshot,
} from '../src/modules/recipes/recipes.snapshot.js';

const url = recipesRegistryIndexUrl(RECIPES_REGISTRY);
const res = await fetch(url, { headers: { 'User-Agent': 'iceslab-sync-recipes' } });
if (!res.ok) {
  console.error(`${url}: HTTP ${res.status}`);
  process.exit(1);
}
const snapshot = buildRecipeSnapshot(new Uint8Array(await res.arrayBuffer()));
const path = recipeSnapshotPath();
writeFileSync(path, serializeRecipeSnapshot(snapshot));
console.log(`${path}: ${snapshot.recipes.length} recipe(s) from ${snapshot.repo}@${snapshot.commit}`);
