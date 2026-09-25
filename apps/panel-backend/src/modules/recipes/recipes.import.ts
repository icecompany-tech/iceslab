import type { RecipeImportRequest, RecipeImportResponse } from '@iceslab/shared';
import { fetchRecipesFromUrl, readRecipes, type ReadRecipes } from './recipes.registry.js';
import { saveOperatorRecipe } from './recipes.mine.js';

/**
 * Ad-hoc import: validate recipes from a one-off URL or pasted JSON, and with
 * `save: true` keep the one recipe as the operator's own. Reuses the same
 * guard + schema validation as the registry, so an imported recipe is held to
 * the identical contract. Throws a message the route surfaces as a 400, and
 * the screen shows as it is.
 *
 * Three refusals are told apart in words (25.09: a GitHub file PAGE answered
 * "no valid recipes", which sent the operator looking for a schema problem):
 *   - the body is not JSON, named by its content-type;
 *   - the JSON is neither a recipe nor a registry;
 *   - there are recipes and none passes, with the reason of the first.
 */
export async function importRecipes(req: RecipeImportRequest): Promise<RecipeImportResponse> {
  let read: ReadRecipes;
  let sourceUrl: string | null = null;
  if (req.url && req.url.trim()) {
    sourceUrl = req.url.trim();
    read = await fetchRecipesFromUrl(sourceUrl); // SSRF guard + validation inside
  } else if (req.json && req.json.trim()) {
    let payload: unknown;
    try {
      payload = JSON.parse(req.json);
    } catch {
      throw new Error('the pasted text is not JSON');
    }
    read = readRecipes(payload);
  } else {
    throw new Error('Provide a url or json to import');
  }

  if (read.shape === 'none') throw new Error('the JSON is neither a recipe nor a recipe registry');
  if (read.total === 0) throw new Error('the registry holds no recipes');
  if (read.recipes.length === 0) {
    // One recipe: its own reason is the answer. Several: how many, and the first.
    throw new Error(
      read.total === 1 ? read.problems[0]! : `none of the ${read.total} recipes passes: ${read.problems[0]}`,
    );
  }

  if (!req.save) return { recipes: read.recipes, saved: null };
  if (read.recipes.length !== 1) {
    throw new Error(
      `save keeps one recipe, and this holds ${read.recipes.length}: ${read.recipes.map((r) => r.id).join(', ')}`,
    );
  }
  const saved = await saveOperatorRecipe(read.recipes[0]!, sourceUrl);
  return { recipes: read.recipes, saved };
}
