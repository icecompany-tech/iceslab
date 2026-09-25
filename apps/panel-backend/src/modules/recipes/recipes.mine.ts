import { RECIPE_SOURCE_MINE, type Recipe, type RecipeSaved } from '@iceslab/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { parseRecipe } from './recipes.schemas.js';

/**
 * The operator's own recipes and the ids they hid (contract 25.09). Own
 * recipes win over every source with the same id; hidden ones stay in the
 * served list and the screen hides them.
 */

export class RecipeNotFoundError extends Error {
  readonly code = 'RECIPE_NOT_FOUND';
  constructor(readonly id: string) {
    super(`no saved recipe ${id}`);
    this.name = 'RecipeNotFoundError';
  }
}

/** Store a recipe as the operator's own, replacing one with the same id. */
export async function saveOperatorRecipe(recipe: Recipe, sourceUrl: string | null): Promise<RecipeSaved> {
  // Provenance is the backend's to stamp on the way out, never stored.
  const { sourceId: _sid, sourceName: _sname, alsoIn: _also, ...plain } = recipe;
  void _sid;
  void _sname;
  void _also;
  const data = { recipe: plain as unknown as Prisma.InputJsonValue, sourceUrl };
  return prisma.$transaction(async (tx) => {
    const before = await tx.operatorRecipe.findUnique({ where: { id: recipe.id }, select: { id: true } });
    await tx.operatorRecipe.upsert({ where: { id: recipe.id }, create: { id: recipe.id, ...data }, update: data });
    return { id: recipe.id, replaced: before !== null };
  });
}

export async function deleteOperatorRecipe(id: string): Promise<void> {
  const { count } = await prisma.operatorRecipe.deleteMany({ where: { id } });
  if (count === 0) throw new RecipeNotFoundError(id);
}

/**
 * The saved recipes, read back through the schema: a row a later panel can no
 * longer read is left out rather than served half-parsed.
 */
export async function listOperatorRecipes(): Promise<Recipe[]> {
  const rows = await prisma.operatorRecipe.findMany({ orderBy: { createdAt: 'asc' } });
  const out: Recipe[] = [];
  for (const row of rows) {
    const recipe = parseRecipe(row.recipe);
    if (!recipe || recipe.id !== row.id) continue;
    out.push({ ...recipe, sourceId: RECIPE_SOURCE_MINE, sourceName: RECIPE_SOURCE_MINE, verified: false });
  }
  return out;
}

export async function getHiddenIds(): Promise<string[]> {
  return (await prisma.recipeHidden.findMany({ orderBy: { id: 'asc' } })).map((r) => r.id);
}

/**
 * Replace the hidden list. Ids no recipe has (`known`) are dropped without a
 * word: a recipe from a snapshot or a source that is gone has nothing to hide.
 * Two tabs racing is accepted, it is a personal list.
 */
export async function setHiddenIds(ids: readonly string[], known: ReadonlySet<string>): Promise<string[]> {
  const keep = [...new Set(ids)].filter((id) => known.has(id)).sort();
  await prisma.$transaction([
    prisma.recipeHidden.deleteMany({}),
    prisma.recipeHidden.createMany({ data: keep.map((id) => ({ id })) }),
  ]);
  return keep;
}
