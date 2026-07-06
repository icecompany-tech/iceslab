import type { Recipe, RecipeImportRequest } from '@iceslab/shared';
import { fetchRecipesFromUrl, parseRecipes } from './recipes.registry.js';

/**
 * Ad-hoc import: validate recipes from a one-off URL or pasted JSON without
 * adding a permanent source. Reuses the same guard + schema validation as the
 * registry, so an imported recipe is held to the identical contract. Throws a
 * human-readable message the route surfaces as a 400.
 */
export async function importRecipes(req: RecipeImportRequest): Promise<Recipe[]> {
  if (req.url && req.url.trim()) {
    return fetchRecipesFromUrl(req.url.trim()); // SSRF guard + validation inside
  }
  if (req.json && req.json.trim()) {
    let payload: unknown;
    try {
      payload = JSON.parse(req.json);
    } catch {
      throw new Error('Pasted content is not valid JSON');
    }
    return parseRecipes(payload);
  }
  throw new Error('Provide a url or json to import');
}
