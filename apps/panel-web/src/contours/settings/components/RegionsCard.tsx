import { useState } from 'react'
import styles from '@/contours/settings/components/settings.module.css'
import { DICT } from '@/contours/settings/dict'
import { useCreateRegion, useDeleteRegion, useRegions, useUpdateRegion } from '@/contours/settings/hooks/useSettingsData'
import { regionNodes, regionUpdateBody } from '@/contours/settings/lib/regionBody'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { conflictField } from '@/lib/old/conflictField'
import type { Region } from '@/lib/old/nodes'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

const FIELDS = ['name', 'code'] as const
const CODE_MAX = 16
type Taken = { field: 'name' | 'code'; message: string } | null

function RegionFields({ value, taken, onChange }: { value: { name: string; code: string }; taken: Taken; onChange: (next: { name: string; code: string }) => void }) {
  const words = useDict(DICT)
  return (
    <>
      <Field label={words.regionName} error={taken?.field === 'name' ? taken.message : undefined}>{(a11y) => <Input {...a11y} placeholder={words.regionNamePlaceholder} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />}</Field>
      <Field label={words.regionCode} error={taken?.field === 'code' ? taken.message : undefined}>{(a11y) => <Input {...a11y} maxLength={CODE_MAX} placeholder={words.regionCodePlaceholder} value={value.code} onChange={(e) => onChange({ ...value, code: e.target.value.toUpperCase() })} />}</Field>
    </>
  )
}

function EditRow({ region, onDone }: { region: Region; onDone: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const update = useUpdateRegion()
  const [draft, setDraft] = useState({ name: region.name, code: region.code })
  const [taken, setTaken] = useState<Taken>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const body = regionUpdateBody(region, draft)
  const send = () =>
    update.mutate(
      { id: region.id, input: body },
      {
        onSuccess: () => {
          toast.show(words.regionUpdated)
          onDone()
        },
        onError: (err) => {
          const read = conflictField(err, FIELDS)
          setTaken(read)
          if (!read) setFailure(failureText(err, locale))
        },
      },
    )
  return (
    <div className={styles.panel}>
      <div className={styles.addRow}>
        <RegionFields
          value={draft}
          taken={taken}
          onChange={(next) => {
            setTaken(null)
            setFailure(null)
            setDraft(next)
          }}
        />
        <Button variant="primary" loading={update.isPending} disabled={Object.keys(body).length === 0 || draft.name.trim() === '' || draft.code.trim() === ''} onClick={send}>
          {words.save}
        </Button>
      </div>
      {failure && <p className={styles.danger}>{failure}</p>}
      <div>
        <Button size="sm" onClick={onDone}>
          {words.cancel}
        </Button>
      </div>
    </div>
  )
}

export function RegionsCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const regions = useRegions()
  const create = useCreateRegion()
  const remove = useDeleteRegion()
  const [draft, setDraft] = useState({ name: '', code: '' })
  const [taken, setTaken] = useState<Taken>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Region | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const add = () =>
    create.mutate(
      { name: draft.name.trim(), code: draft.code.trim() },
      {
        onSuccess: () => {
          setDraft({ name: '', code: '' })
          toast.show(words.regionCreated)
        },
        onError: (err) => {
          const read = conflictField(err, FIELDS)
          setTaken(read)
          if (!read) setFailure(failureText(err, locale))
        },
      },
    )
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null)
        toast.show(words.regionDeleted)
      },
      onError: (err) => setDeleteError(failureText(err, locale)),
    })
  }
  const deleteWords = (r: Region) => {
    const n = regionNodes(r)
    if (n === null) return words.regionDeleteUnknown
    return n > 0 ? words.regionDeleteWithNodes(n) : words.regionDeleteSafe
  }
  const list = regions.data?.regions ?? []
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.regionsTitle}</h2>
      <p className={styles.note}>{words.regionsHint}</p>
      {regions.isPending && <QueryLoading label={words.loading} />}
      {regions.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void regions.refetch()}>
          {`${words.regionsFailed}: ${failureText(regions.error, locale)}`}
        </QueryFailedLine>
      )}
      {regions.data && list.length === 0 && <p className={styles.note}>{words.regionsEmpty}</p>}
      {list.map((r) => {
        const n = regionNodes(r)
        return editing === r.id ? (
          <EditRow key={r.id} region={r} onDone={() => setEditing(null)} />
        ) : (
          <div key={r.id} className={styles.row}>
            <span className={styles.code}>{r.code}</span>
            <span className={styles.rowName}>{r.name}</span>
            <span className={styles.note}>{n === null ? words.nodesUnknown : words.nodesCount(n)}</span>
            <Button size="sm" onClick={() => setEditing(r.id)}>
              {words.edit}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
              {words.deleteAction}
            </Button>
          </div>
        )
      })}
      <div className={styles.addRow}>
        <RegionFields
          value={draft}
          taken={taken}
          onChange={(next) => {
            setTaken(null)
            setFailure(null)
            setDraft(next)
          }}
        />
        <Button loading={create.isPending} disabled={draft.name.trim() === '' || draft.code.trim() === ''} onClick={add}>
          {words.add}
        </Button>
      </div>
      {failure && <p className={styles.danger}>{failure}</p>}
      {deleting && (
        <Confirm title={words.regionDeleteTitle(deleting.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{deleteWords(deleting)}</p>
        </Confirm>
      )}
    </section>
  )
}
