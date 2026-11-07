import { useState } from 'react'
import styles from '@/contours/profiles/components/profiles.module.css'
import { AllRecipesWindow, ExportRecipeWindow, ImportRecipeWindow } from '@/contours/profiles/components/RecipeWindows'
import { useRecipeWords, useTileRecipes, type RecipeKind } from '@/contours/profiles/hooks/useRecipes'
import type { Recipe } from '@/contours/profiles/lib/recipes'
import { DICT } from '@/contours/profiles/recipesDict'
import { useDict } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { QueryLoading } from '@/ui/QueryState/QueryState'

type Open = 'all' | 'import' | 'export' | null

export interface RecipeRailProps {
  kind: RecipeKind
  /** A saved profile exports from the server; null exports from the form. */
  profileId: string | null
  values: Record<string, unknown>
  onApply: (recipe: Recipe) => void
  /** Arrived from "start from a recipe": the list opens at once. */
  startOpen: boolean
}

/** A shortcut into the fields, not a step before them: it fills what is easy to get wrong and locks nothing. */
export function RecipeRail({ kind, profileId, values, onApply, startOpen }: RecipeRailProps) {
  const words = useDict(DICT)
  const text = useRecipeWords()
  const tile = useTileRecipes(kind)
  const [open, setOpen] = useState<Open>(startOpen ? 'all' : null)
  const [applied, setApplied] = useState<Recipe | null>(null)
  const apply = (recipe: Recipe) => {
    setApplied(recipe)
    setOpen(null)
    onApply(recipe)
  }
  const appliedCopy = applied && text(applied)
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.title}</h2>
      {tile.query.isPending && <QueryLoading label={words.loading} />}
      {tile.empty === 'unavailable' && <p className={styles.note}>{words.unavailable}</p>}
      {tile.empty === 'tile' && <p className={styles.note}>{words.noneForTile(kind.label)}</p>}
      {tile.curated.length > 0 && (
        <ul className={styles.recipeRail}>
          {tile.curated.map((recipe) => {
            const copy = text(recipe)
            const on = applied?.id === recipe.id
            return (
              <li key={recipe.id}>
                <button type="button" className={on ? styles.recipeOn : styles.recipeOff} aria-pressed={on} onClick={() => apply(recipe)}>
                  <span>{copy.name}</span>
                  <span className={styles.note}>{copy.description}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {appliedCopy && (
        <div role="status">
          <p className={styles.note}>{words.applied(appliedCopy.name)}</p>
          {appliedCopy.notes?.map((note) => (
            <p key={note} className={styles.amberNote}>
              {note}
            </p>
          ))}
        </div>
      )}
      <div className={styles.railActions}>
        <Button size="sm" onClick={() => setOpen('all')}>
          {words.all}
        </Button>
        <Button size="sm" onClick={() => setOpen('import')}>
          {words.import}
        </Button>
        <Button size="sm" onClick={() => setOpen('export')}>
          {words.export}
        </Button>
      </div>
      {open === 'all' && <AllRecipesWindow tile={tile} kindLabel={kind.label} onApply={apply} onImport={() => setOpen('import')} onClose={() => setOpen(null)} />}
      {open === 'import' && <ImportRecipeWindow kind={kind} onApply={apply} onClose={() => setOpen(null)} />}
      {open === 'export' && <ExportRecipeWindow profileId={profileId} protocol={kind.protocol} values={values} onClose={() => setOpen(null)} />}
    </section>
  )
}
