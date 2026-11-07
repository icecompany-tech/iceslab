import { useState } from 'react'
import styles from '@/contours/profiles/components/profiles.module.css'
import { useDeleteRecipe, useImportRecipes, useProfileRecipe, useRecipeWords, useRefreshRegistry, useSetHidden, type RecipeKind, type TileRecipes } from '@/contours/profiles/hooks/useRecipes'
import { recipeImportUrl } from '@/contours/profiles/lib/recipeImportUrl'
import { buildExportRecipe, downloadRecipeJson, fromWireRecipe, hiddenAfter, importSaved, recipeFitsForm, recipeNotFound, registryRecipePath, type Recipe, type RecipeProtocol } from '@/contours/profiles/lib/recipes'
import { DICT } from '@/contours/profiles/recipesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { CodeArea } from '@/ui/CodeArea/CodeArea'
import { Command } from '@/ui/Command/Command'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { RadioRow } from '@/ui/RadioRow/RadioRow'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const ALL_REGIONS = 'ALL'
const GLOBAL = 'GLOBAL'
const REGIONS = [GLOBAL, 'RU', 'IR', 'CN', 'BY']
const EXPORT_RATING = 3

const regionOf = (recipe: Recipe) => recipe.region ?? GLOBAL
/** Two sources can ship one id, so a row is keyed by source and id. */
const recipeKey = (recipe: Recipe) => (recipe.sourceId ? `${recipe.sourceId}:${recipe.id}` : recipe.id)

export interface AllRecipesProps {
  tile: TileRecipes
  kindLabel: string
  onApply: (recipe: Recipe) => void
  onImport: () => void
  onClose: () => void
}

/** The full list of the tile: search, region, hide, own ones with a delete, the hidden ones back. */
export function AllRecipesWindow({ tile, kindLabel, onApply, onImport, onClose }: AllRecipesProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const text = useRecipeWords()
  const setHidden = useSetHidden()
  const remove = useDeleteRecipe()
  const refresh = useRefreshRegistry()
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState(ALL_REGIONS)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [deleting, setDeleting] = useState<Recipe | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const all = [...tile.curated, ...tile.others]
  const regions = [...new Set(all.map(regionOf))].sort()
  const query = search.trim().toLowerCase()
  const shown = all.filter((recipe) => {
    const copy = text(recipe)
    return (region === ALL_REGIONS || regionOf(recipe) === region) && (query === '' || `${copy.name} ${copy.description}`.toLowerCase().includes(query))
  })
  const changeHidden = (id: string, action: 'hide' | 'show') => setHidden.mutate(hiddenAfter(tile.hiddenIds, id, action), { onError: (err) => toast.show(failureText(err, locale), 'failed') })
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (err) => {
        // Deleted from another tab: said, and the list reread.
        if (recipeNotFound(err)) {
          toast.show(words.alreadyGone, 'partial')
          refresh()
          setDeleting(null)
        } else setDeleteError(failureText(err, locale))
      },
    })
  }
  const failed = tile.problems ?? []
  const regionLabel = (value: string) => (value === GLOBAL ? words.regionGlobal : value)
  return (
    <Dialog
      title={words.all}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onImport}>{words.import}</Button>
          <Button onClick={onClose}>{words.close}</Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <p className={styles.note}>
          {words.fromRegistry}{' '}
          <a className={styles.link} href={tile.repo.url} target="_blank" rel="noreferrer">
            {tile.repo.name}
          </a>
          {' · '}
          {words.proposeOwn}{' '}
          <a className={styles.link} href={`${tile.repo.url}/pulls`} target="_blank" rel="noreferrer">
            pull request
          </a>
        </p>
        <div className={styles.twoFields}>
          <Input aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          {regions.length > 1 && <Select aria-label={words.region} value={region} onChange={(e) => setRegion(e.target.value)} options={[{ value: ALL_REGIONS, label: words.regionAll }, ...regions.map((value) => ({ value, label: regionLabel(value) }))]} />}
        </div>
        {tile.query.isPending && <QueryLoading label={words.loading} />}
        {tile.query.isError && (
          <QueryFailedLine retryLabel={words.import} onRetry={onImport}>
            {words.unavailable}
          </QueryFailedLine>
        )}
        {tile.empty === 'unavailable' && !tile.query.isError && <p className={styles.note}>{words.unavailable}</p>}
        {tile.empty === 'tile' && <p className={styles.note}>{words.noneForTile(kindLabel)}</p>}
        {tile.empty === null && !tile.query.isPending && shown.length === 0 && <p className={styles.note}>{words.noMatch}</p>}
        {tile.stale && tile.empty === null && tile.problems === null && <p className={styles.note}>{words.stale}</p>}
        {shown.length > 0 && (
          <ul className={styles.recipeRows}>
            {shown.map((recipe) => {
              const copy = text(recipe)
              const alsoIn = recipe.alsoIn ?? []
              return (
                <li key={recipeKey(recipe)} className={styles.recipeRow}>
                  <div className={styles.recipeText}>
                    <div className={styles.recipeName}>
                      {copy.name}
                      {recipe.source === 'mine' && <span className={styles.recipeBadge}>{words.mine}</span>}
                      {recipe.source === 'registry' && <span className={styles.recipeBadge}>{recipe.verified ? words.official : words.community}</span>}
                    </div>
                    <p className={styles.note}>{copy.description}</p>
                    <p className={styles.note}>{[words.dpi(recipe.dpiResistance), words.speed(recipe.speed), recipe.author ? words.byAuthor(recipe.author) : '', alsoIn.length > 0 ? words.alsoIn(alsoIn.join(', ')) : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className={styles.recipeActions}>
                    {recipe.source === 'mine' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setDeleteError(null)
                          setDeleting(recipe)
                        }}
                      >
                        {words.delete}
                      </Button>
                    )}
                    {recipe.source !== 'mine' && tile.canHide && (
                      <Button size="sm" onClick={() => changeHidden(recipe.id, 'hide')}>
                        {words.hide}
                      </Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => onApply(recipe)}>
                      {words.apply}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {failed.map((problem) => (
          <p key={problem.id} className={styles.note}>
            {words.reason[problem.reason](problem.name)}
          </p>
        ))}
        {tile.skips.map((skip) => (
          <div key={skip.name}>
            <p className={styles.note}>{words.skipped(skip.name, skip.problems.length)}</p>
            {skip.problems.map((line) => (
              <p key={line} className={styles.mono}>
                {line}
              </p>
            ))}
          </div>
        ))}
        {tile.dupes.length > 0 && <p className={styles.danger}>{words.duplicates(tile.dupes.join(', '))}</p>}
        {tile.hidden.length > 0 && (
          <div>
            <button type="button" className={styles.textButton} aria-expanded={hiddenOpen} onClick={() => setHiddenOpen(!hiddenOpen)}>
              {hiddenOpen ? words.collapseHidden(tile.hidden.length) : words.expandHidden(tile.hidden.length)}
            </button>
            {hiddenOpen && (
              <ul className={styles.recipeRows}>
                {tile.hidden.map((recipe) => (
                  <li key={recipeKey(recipe)} className={styles.recipeRow}>
                    <span>{text(recipe).name}</span>
                    <Button size="sm" onClick={() => changeHidden(recipe.id, 'show')}>
                      {words.restore}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {deleting && (
        <Confirm title={words.deleteTitle(text(deleting).name)} labels={{ confirm: words.delete, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{words.deleteBody}</p>
        </Confirm>
      )}
    </Dialog>
  )
}

export interface ImportRecipeProps {
  kind: RecipeKind
  onApply: (recipe: Recipe) => void
  onClose: () => void
}

/**
 * A link or the JSON; the server checks it against the same schema, then one is picked. The server
 * saves exactly one recipe and refuses a file with several, so loading goes without `save` and the
 * saved one is the picked one, in a request of its own.
 */
export function ImportRecipeWindow({ kind, onApply, onClose }: ImportRecipeProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const text = useRecipeWords()
  const load = useImportRecipes()
  const persist = useImportRecipes()
  const refresh = useRefreshRegistry()
  const [url, setUrl] = useState('')
  const [json, setJson] = useState('')
  const [found, setFound] = useState<{ all: number; matched: Recipe[]; wire: Map<string, unknown> } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [picked, setPicked] = useState<Recipe | null>(null)
  const [save, setSave] = useState(true)
  const target = recipeImportUrl(url)
  const reset = () => {
    setFound(null)
    setRefused(null)
    setPicked(null)
  }
  const send = () => {
    reset()
    load.mutate(target.url ? { url: target.url } : { json: json.trim() }, {
      onSuccess: (data) => {
        const all = data.recipes.map(fromWireRecipe)
        // Only the recipes of this tile apply: a Telegram SOCKS5 recipe is xray too, and would turn a vless form into socks.
        const matched = all.filter((recipe) => recipeFitsForm(recipe, kind.kindKey, kind.subprotocol))
        setFound({ all: all.length, matched, wire: new Map(data.recipes.map((one) => [one.id, one] as const)) })
        setPicked(matched[0] ?? null)
        if (matched.length === 0) setRefused(all.length > 0 ? words.wrongProtocol(kind.label) : words.none)
      },
      onError: (err) => setRefused(words.importFailed(failureText(err, locale))),
    })
  }
  const apply = () => {
    if (!picked) return
    onApply(picked)
    const wire = found?.wire.get(picked.id)
    if (save && wire) {
      persist.mutate(
        { json: JSON.stringify(wire), save: true },
        {
          onSuccess: (data) => {
            const saved = importSaved(data.saved)
            if (!saved) return
            toast.show(saved.replaced ? words.replaced(text(picked).name) : words.saved(text(picked).name))
            refresh()
          },
          onError: (err) => toast.show(words.saveFailed(failureText(err, locale)), 'failed'),
        },
      )
    }
    onClose()
  }
  const rewritten = target.rewritten ? `${words.rewritten(target.url)}${target.fromGistPage ? ` ${words.gistFirst}` : ''}` : undefined
  return (
    <Dialog
      title={words.importTitle}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          {found && found.matched.length > 0 ? (
            <Button variant="primary" disabled={!picked} onClick={apply}>
              {words.apply}
            </Button>
          ) : (
            <Button variant="primary" loading={load.isPending} disabled={url.trim() === '' && json.trim() === ''} onClick={send}>
              {words.load}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.windowBody}>
        <p className={styles.note}>{words.importHint}</p>
        <Field label={words.urlLabel} hint={rewritten} error={refused ?? undefined}>
          {(a11y) => (
            <Input
              {...a11y}
              placeholder="https://raw.githubusercontent.com/you/recipes/main/xray-my.json"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                reset()
              }}
            />
          )}
        </Field>
        <CodeArea
          label={words.jsonLabel}
          minRows={3}
          value={json}
          onChange={(next) => {
            setJson(next)
            reset()
          }}
        />
        {found && found.matched.length > 0 && (
          <>
            <h3 className={styles.panelTitle}>{words.pick}</h3>
            {found.all > found.matched.length && <p className={styles.note}>{words.hiddenOther(found.all - found.matched.length)}</p>}
            {found.matched.map((recipe) => (
              <RadioRow key={recipeKey(recipe)} name="recipe" title={text(recipe).name} description={text(recipe).description} checked={picked?.id === recipe.id} onSelect={() => setPicked(recipe)} />
            ))}
            <Check label={words.saveLabel} checked={save} onChange={setSave} />
            <p className={styles.note}>{words.saveHint}</p>
          </>
        )}
      </div>
    </Dialog>
  )
}

export interface ExportRecipeProps {
  /** Null: the profile is not saved yet, the recipe comes from the form. */
  profileId: string | null
  protocol: RecipeProtocol
  values: Record<string, unknown>
  onClose: () => void
}

/** A saved profile's recipe is built by the server from what is saved; an unsaved one from the form. Nothing is stored. */
export function ExportRecipeWindow({ profileId, protocol, values, onClose }: ExportRecipeProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const query = useProfileRecipe(profileId)
  const [edited, setEdited] = useState<{ name?: string; description?: string; region?: string }>({})
  // As the server built it: the screen's own provenance stamp must not leak into a shared file.
  const server = query.data ?? null
  const name = edited.name ?? server?.name ?? ''
  const description = edited.description ?? server?.description ?? ''
  const region = edited.region ?? server?.region ?? GLOBAL
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `${protocol}-custom`
  const recipe = server ? { ...server, name, description, region } : profileId === null ? buildExportRecipe(protocol, values, { id: slug, name: name.trim() || slug, description: description.trim() || name.trim(), dpiResistance: EXPORT_RATING, speed: EXPORT_RATING, region }) : null
  const text = recipe ? JSON.stringify(recipe, null, 2) : ''
  return (
    <Dialog
      title={words.exportTitle}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.close}</Button>
          <Button variant="primary" disabled={!recipe || (profileId === null && name.trim() === '')} onClick={() => recipe && downloadRecipeJson(recipe)}>
            {words.download}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <p className={styles.note}>{profileId ? words.fromSaved : words.fromForm}</p>
        {query.isLoading && <QueryLoading label={words.loading} />}
        {query.isError && <Banner tone="danger">{words.exportFailed(failureText(query.error, locale))}</Banner>}
        {recipe && (
          <>
            <div className={styles.twoFields}>
              <Field label={words.exportName}>{(a11y) => <Input {...a11y} value={name} onChange={(e) => setEdited({ ...edited, name: e.target.value })} />}</Field>
              <Field label={words.exportRegion}>{(a11y) => <Select {...a11y} value={region} onChange={(e) => setEdited({ ...edited, region: e.target.value })} options={REGIONS.map((value) => ({ value, label: value === GLOBAL ? words.regionGlobal : value }))} />}</Field>
            </div>
            <Field label={words.exportDescription}>{(a11y) => <Input {...a11y} value={description} onChange={(e) => setEdited({ ...edited, description: e.target.value })} />}</Field>
            <p className={styles.note}>{words.pathHint}</p>
            <Command text={registryRecipePath(recipe)} copyLabel={words.copy} copiedLabel={words.copied} />
            <p className={styles.amberNote}>{words.ratings}</p>
            <CodeArea label={words.exportTitle} readOnly value={text} minRows={8} />
          </>
        )}
      </div>
    </Dialog>
  )
}
