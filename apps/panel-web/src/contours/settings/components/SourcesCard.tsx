import type { RecipeSource } from '@iceslab/shared'
import { useState } from 'react'
import styles from '@/contours/settings/components/settings.module.css'
import { DICT } from '@/contours/settings/dict'
import { useAddSource, useDeleteSource, useSources, useToggleSource } from '@/contours/settings/hooks/useSettingsData'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

export function SourcesCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const sources = useSources()
  const addSource = useAddSource()
  const toggle = useToggleSource()
  const remove = useDeleteSource()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RecipeSource | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const list = sources.data?.sources ?? []
  const add = () => {
    setFailure(null)
    addSource.mutate(
      { name: name.trim(), url: url.trim() },
      {
        onSuccess: () => {
          setName('')
          setUrl('')
          toast.show(words.sourceAdded)
        },
        onError: (err) => setFailure(failureText(err, locale)),
      },
    )
  }
  const flip = (s: RecipeSource, enabled: boolean) => toggle.mutate({ id: s.id, enabled }, { onError: (err) => setFailure(failureText(err, locale)) })
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null)
        toast.show(words.sourceDeleted)
      },
      onError: (err) => setDeleteError(failureText(err, locale)),
    })
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.sourcesTitle}</h2>
      <p className={styles.note}>{words.sourcesHint}</p>
      {sources.isPending && <QueryLoading label={words.loading} />}
      {sources.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void sources.refetch()}>
          {`${words.sourcesFailed}: ${failureText(sources.error, locale)}`}
        </QueryFailedLine>
      )}
      {sources.data && list.length === 0 && <p className={styles.note}>{words.sourcesEmpty}</p>}
      {list.map((s) => (
        <div key={s.id} className={styles.row}>
          <span className={styles.rowName}>
            {s.name} {s.trusted && <span className={styles.code}>{words.sourceOfficial}</span>}
            <span className={styles.mono}>{s.url}</span>
          </span>
          <Switch labelHidden label={words.sourceEnabled(s.name)} checked={s.enabled} onChange={(on) => flip(s, on)} />
          <Button size="sm" variant="danger" onClick={() => setDeleting(s)}>
            {words.deleteAction}
          </Button>
        </div>
      ))}
      <div className={styles.addRow}>
        <Field label={words.sourceName}>{(a11y) => <Input {...a11y} placeholder={words.sourceNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={words.sourceUrl}>{(a11y) => <Input {...a11y} placeholder="https://.../index.json" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
        <Button loading={addSource.isPending} disabled={name.trim() === '' || url.trim() === ''} onClick={add}>
          {words.add}
        </Button>
      </div>
      <p className={styles.note}>{words.sourceUrlHint}</p>
      {failure && <p className={styles.danger}>{failure}</p>}
      {deleting && (
        <Confirm title={words.sourceDeleteTitle(deleting.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{words.sourceDeleteBody}</p>
        </Confirm>
      )}
    </section>
  )
}
