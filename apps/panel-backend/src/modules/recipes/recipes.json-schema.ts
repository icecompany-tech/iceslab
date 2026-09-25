import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { RECIPE_SCHEMA_VERSION } from '@iceslab/shared';
import { RecipeObject } from './recipes.schemas.js';

/**
 * The recipe schema as JSON Schema, for the registry to validate its files
 * with instead of a hand copy of our rules. Generated from the zod object the
 * panel itself parses with (zod 4's own z.toJSONSchema), written by
 * scripts/recipe-json-schema.ts to packages/shared/recipe.schema.json and
 * committed; recipes.snapshot.test.ts holds the file to a fresh generation.
 *
 * Two rules live in zod refinements, which z.toJSONSchema cannot carry, and
 * are added here by hand, each a copy of one line of RecipeSchema:
 *   - schemaVersion is 2 (the panel parses any int, to refuse v1 by name);
 *   - an xray recipe names its subprotocol, no other protocol takes one.
 * What stays panel-only: apply.xraySubprotocol equal to subprotocol, the cap
 * of 40 apply keys and the apply keys a recipe may not set.
 */
export function recipeJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(RecipeObject, { io: 'input', unrepresentable: 'any' }) as {
    properties: Record<string, unknown>;
  } & Record<string, unknown>;
  return {
    ...generated,
    $id: 'https://raw.githubusercontent.com/icecompany-tech/iceslab/main/packages/shared/recipe.schema.json',
    title: 'Iceslab recipe',
    properties: { ...generated.properties, schemaVersion: { type: 'integer', const: RECIPE_SCHEMA_VERSION } },
    if: { properties: { protocol: { const: 'xray' } }, required: ['protocol'] },
    then: { required: ['subprotocol'] },
    else: { not: { required: ['subprotocol'] } },
  };
}

export function serializeRecipeJsonSchema(): string {
  return `${JSON.stringify(recipeJsonSchema(), null, 2)}\n`;
}

/** packages/shared/recipe.schema.json, resolved through the shared package. */
export function recipeJsonSchemaPath(): string {
  const req = createRequire(import.meta.url);
  // The index (src/index.ts) is the one entry that always exists; the schema
  // sits at the package root, one level above it.
  return join(dirname(req.resolve('@iceslab/shared')), '..', 'recipe.schema.json');
}
