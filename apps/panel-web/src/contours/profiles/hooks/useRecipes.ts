import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { duplicateRecipeIds, fromWireRecipe, isCuratedRecipe, recipeFitsForm, recipeRailEmpty, recipeText, registryProblems, registryRepo, registrySkips, splitHidden, type Recipe, type RecipeProtocol } from '@/contours/profiles/lib/recipes'
import { DICT } from '@/contours/profiles/recipesDict'
import { useDict } from '@/lib/i18n'
import { deleteMyRecipe, getProfileRecipe, getRecipeRegistry, importRecipes, setHiddenRecipes, type RecipeRegistryAnswer } from '@/lib/old/recipes'

const REGISTRY_STALE_MS = 5 * 60 * 1000
const REGISTRY = ['recipes', 'registry'] as const

/** Which form tile the recipes are for. */
export interface RecipeKind {
  kindKey: string
  subprotocol: string
  protocol: RecipeProtocol
  label: string
}

/** Every recipe comes from the registry answer; a recipe lands on the tile its engine, protocol and subprotocol say. */
export function useTileRecipes({ kindKey, subprotocol, protocol }: RecipeKind) {
  const query = useQuery({ queryKey: [...REGISTRY, protocol], queryFn: () => getRecipeRegistry({ protocol }), staleTime: REGISTRY_STALE_MS, retry: 1 })
  const answer = query.data
  return useMemo(() => {
    const onTile = (answer?.recipes ?? []).map(fromWireRecipe).filter((recipe) => recipeFitsForm(recipe, kindKey, subprotocol))
    const split = splitHidden(onTile, answer?.hidden)
    const curated = split.shown.filter(isCuratedRecipe)
    const others = split.shown.filter((r) => !isCuratedRecipe(r))
    const empty = recipeRailEmpty({ loading: query.isPending, failed: query.isError, stale: answer?.stale ?? false, answered: answer?.recipes.length ?? 0, shown: curated.length + others.length })
    return {
      query,
      hiddenIds: answer?.hidden,
      curated,
      others,
      hidden: split.hidden,
      // Hiding needs a server that has the field.
      canHide: answer?.hidden !== undefined,
      dupes: duplicateRecipeIds(onTile),
      problems: registryProblems(answer),
      skips: registrySkips(answer),
      stale: answer?.stale ?? false,
      empty,
      repo: registryRepo(answer?.source),
    }
  }, [answer, kindKey, subprotocol, query])
}

export type TileRecipes = ReturnType<typeof useTileRecipes>

/** A whole replacement: the screen takes the list from the answer, an id the server dropped leaves the screen too. */
export function useSetHidden() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: setHiddenRecipes,
    onSuccess: ({ hidden }) => {
      client.setQueriesData<RecipeRegistryAnswer>({ queryKey: REGISTRY }, (old) => (old ? { ...old, hidden } : old))
    },
  })
}

export function useRefreshRegistry() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: REGISTRY })
}

export function useDeleteRecipe() {
  const refresh = useRefreshRegistry()
  return useMutation({ mutationFn: deleteMyRecipe, onSuccess: refresh })
}

export const useImportRecipes = () => useMutation({ mutationFn: importRecipes })

export const useProfileRecipe = (profileId: string | null) => useQuery({ queryKey: ['profile-recipe', profileId], queryFn: () => getProfileRecipe(profileId ?? ''), enabled: profileId !== null, retry: false, staleTime: 0 })

/** A recipe's words: the panel's translation by id where it has one, else what the author wrote. */
export function useRecipeWords() {
  const words = useDict(DICT)
  return (recipe: Pick<Recipe, 'id' | 'name' | 'description' | 'details' | 'notes'>) => {
    const part = (key: string) => {
      const [, , id, suffix] = key.split('.')
      const card = words.cards[id ?? '']
      return card?.[(suffix ?? '') as keyof typeof card]
    }
    return recipeText(recipe, (key) => part(key) !== undefined, part)
  }
}
