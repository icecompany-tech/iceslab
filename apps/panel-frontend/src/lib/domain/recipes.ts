import type {
  Recipe as WireRecipe,
  RecipeRegistryResponse,
  RecipeSource,
  RecipeSourceInput,
  RecipeImportResponse,
} from '@iceslab/shared';
import { api } from '@/lib/net/client';

/**
 * Transport-recipe registry (community recipes pulled from GitHub). Best
 * effort: the backend returns `stale: true` plus the last-good or empty set
 * on failure, never an error, so the RecipePicker falls back to built-ins.
 */
export async function getRecipeRegistry(params?: {
  protocol?: string;
  region?: string;
}): Promise<RecipeRegistryAnswer> {
  const { data } = await api.get<RecipeRegistryAnswer>(
    '/api/recipes/registry',
    { params },
  );
  return data;
}

// Recipe sources (bring your own GitHub): operator-managed list the registry
// merges from. The default (curated) source is seeded server-side.
export async function getRecipeSources(): Promise<{ sources: RecipeSource[] }> {
  const { data } = await api.get<{ sources: RecipeSource[] }>('/api/recipes/sources');
  return data;
}

export async function addRecipeSource(input: RecipeSourceInput): Promise<RecipeSource> {
  const { data } = await api.post<RecipeSource>('/api/recipes/sources', input);
  return data;
}

export async function updateRecipeSource(
  id: string,
  patch: Partial<RecipeSourceInput>,
): Promise<RecipeSource> {
  const { data } = await api.patch<RecipeSource>(`/api/recipes/sources/${id}`, patch);
  return data;
}

export async function deleteRecipeSource(id: string): Promise<void> {
  await api.delete(`/api/recipes/sources/${id}`);
}

/*
 * «Свои и скрытые» (контракт ARCH 25.09). Поля ниже BACK кладёт в shared
 * вместе с реестром v2; до его коммита экран описывает их здесь, как
 * необязательные: сервер старше их не отдаёт, и экран тогда молчит.
 */

/** `sourceId` своего рецепта (сохранённого из импорта). */
export const RECIPE_SOURCE_MINE = 'mine';

/** Ответ реестра с `hidden`: id, которые оператор скрыл. Скрытые остаются
 *  в `recipes`, прячет их экран. */
export type RecipeRegistryAnswer = RecipeRegistryResponse & { hidden?: string[] };

/** Ответ импорта с `saved`: что сохранено и заменило ли прежний с тем же id. */
export type RecipeImportAnswer = RecipeImportResponse & { saved?: { id: string; replaced: boolean } | null };

/** Ad-hoc import: validate recipes from a one-off URL or pasted JSON; `save`
 *  keeps the recipe in the panel as the operator's own. */
export async function importRecipes(body: { url?: string; json?: string; save?: boolean }): Promise<RecipeImportAnswer> {
  const { data } = await api.post<RecipeImportAnswer>('/api/recipes/import', body);
  return data;
}

/**
 * Сохранённый профиль как рецепт реестра (схема v2), собранный сервером:
 * только поля, которые несут рецепты реестра; случайные значения уходят как
 * `randomize`, а не значением этого профиля. Ничего не сохраняется.
 */
export async function getProfileRecipe(profileId: string): Promise<WireRecipe> {
  const { data } = await api.get<WireRecipe>(`/api/profiles/${encodeURIComponent(profileId)}/recipe`);
  return data;
}

/** Удалить свой рецепт. 204; 404 RECIPE_NOT_FOUND, если его уже нет. */
export async function deleteMyRecipe(id: string): Promise<void> {
  await api.delete(`/api/recipes/mine/${encodeURIComponent(id)}`);
}

/** Скрытые id полной заменой; ответ это список, который сервер оставил
 *  (лишние и неизвестные id он отбрасывает молча). */
export async function setHiddenRecipes(ids: string[]): Promise<{ hidden: string[] }> {
  const { data } = await api.put<{ hidden: string[] }>('/api/recipes/hidden', { ids });
  return data;
}
