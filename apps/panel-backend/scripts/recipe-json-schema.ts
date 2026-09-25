/**
 * Write packages/shared/recipe.schema.json from the panel's recipe schema:
 *
 *   pnpm --filter @iceslab/panel-backend gen:recipe-schema
 *
 * Run it after changing RecipeObject (recipes.schemas.ts) and commit the file;
 * recipes.snapshot.test.ts is red until it equals a fresh generation.
 */
import { writeFileSync } from 'node:fs';
import { recipeJsonSchemaPath, serializeRecipeJsonSchema } from '../src/modules/recipes/recipes.json-schema.js';

const path = recipeJsonSchemaPath();
writeFileSync(path, serializeRecipeJsonSchema());
console.log(`${path}: written`);
