import type {
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
}): Promise<RecipeRegistryResponse> {
  const { data } = await api.get<RecipeRegistryResponse>(
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

/** Ad-hoc import: validate recipes from a one-off URL or pasted JSON. */
export async function importRecipes(body: {
  url?: string;
  json?: string;
}): Promise<RecipeImportResponse> {
  const { data } = await api.post<RecipeImportResponse>('/api/recipes/import', body);
  return data;
}
