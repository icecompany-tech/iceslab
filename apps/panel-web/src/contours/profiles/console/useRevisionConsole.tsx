import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'
import { listProfileRevisions, readProfileRevisionDiff, restoreProfileRevision, type ProfileRevisionDiff } from '@/lib/old/profiles'
import { Button } from '@/ui/Button/Button'
import { Diff } from '@/ui/CodeArea/Diff'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import styles from '@/contours/profiles/components/profiles.module.css'
import { DICT as PROFILE_WORDS } from '@/contours/profiles/dict'
import { DICT } from '@/contours/profiles/revisionDict'

function diffText(comparison: ProfileRevisionDiff, side: 'before' | 'after') {
  const omitted = side === 'before' ? 'added' : 'removed'
  return comparison.changes.filter(change => change.kind !== omitted)
    .map(change => JSON.stringify(change.path.join('.')) + ': ' + JSON.stringify(change[side])).join('\n')
}

export function useRevisionConsole(id: string | undefined, dirty: boolean, locked: boolean, onRestored: () => Promise<void>) {
  const words = useDict(DICT)
  const { cancel, retry } = useDict(PROFILE_WORDS)
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<number | null>(null)
  const [ask, setAsk] = useState<ProfileRevisionDiff | null>(null)
  const [notice, setNotice] = useState('')
  const list = useInfiniteQuery({
    queryKey: ['profile-revisions', id],
    queryFn: ({ pageParam }) => listProfileRevisions(id ?? '', pageParam),
    enabled: id !== undefined && open,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: page => page.nextBefore ?? undefined,
  })
  const listHead = list.data?.pages[0]?.currentRevision
  const comparison = useQuery({
    queryKey: ['profile-revision-diff', id, target],
    queryFn: async () => {
      const result = await readProfileRevisionDiff(id ?? '', target ?? 0)
      if (listHead !== result.currentRevision) void list.refetch()
      return result
    },
    enabled: id !== undefined && target !== null,
  })
  const restore = useMutation({
    mutationFn: (snapshot: ProfileRevisionDiff) =>
      restoreProfileRevision(id ?? '', snapshot.targetRevision, snapshot.currentRevision),
  })
  const record = comparison.data
  const current = record?.currentRevision ?? listHead
  const canRestore = record && !comparison.isFetching && !comparison.isError &&
    record.currentRevision !== record.targetRevision && !locked
  const select = (revision: number | null) => {
    setNotice('')
    setTarget(revision)
  }
  const refresh = () => {
    void list.refetch()
    void comparison.refetch()
  }
  const confirm = async () => {
    if (!ask || restore.isPending || locked) return
    try {
      await restore.mutateAsync(ask)
    } catch (error) {
      if (isApiError(error) && (error.code === 'PROFILE_REVISION_CONFLICT' || error.status === 0)) {
        setNotice(error.status === 0 ? words.unknownRestore : words.conflict)
        setAsk(null)
        refresh()
      }
      return
    }
    setAsk(null)
    select(null)
    void list.refetch()
    await onRestored()
  }

  const button = id !== undefined && (
    <button type="button" className={styles.revisionToggle} aria-label={words.title}
      aria-expanded={open} aria-controls={open ? 'profile-revisions' : undefined}
      onClick={() => {
        setOpen(!open)
        if (open) select(null)
      }}>
      <Icon name="rotateLeft" />
    </button>
  )
  const rows = list.data?.pages.flatMap(page => page.revisions) ?? []
  const rail = open && (
    <section id="profile-revisions" className={styles.revisions} aria-labelledby="revision-title">
      <header><h2 id="revision-title">{words.title}</h2><p>{words.guide}</p></header>
      {list.isPending && <QueryLoading label={words.loading} />}
      {list.isError && <QueryFailedLine retryLabel={retry} onRetry={() => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch())}>{words.listFailed}</QueryFailedLine>}
      {list.isSuccess && rows.length === 0 && <p>{words.empty}</p>}
      {rows.map(row => (
        <div className={styles.revisionRow} key={row.revision} data-selected={target === row.revision}>
          <div>
            <span>{fmtDateTime(row.createdAt, locale)}{row.actor ? ', ' + row.actor.name : ''}</span>
            <small>{row.restoredFrom === null ? words.source[row.source ?? row.kind] : words.restoredFrom(row.restoredFrom)}</small>
          </div>
          {row.revision === current ? <small>{words.current}</small> :
            <button type="button" aria-pressed={target === row.revision} onClick={() => select(target === row.revision ? null : row.revision)}>
              {target === row.revision ? words.selected : words.diff}<span className={styles.revisionSr}> {words.number(row.revision)}</span>
            </button>}
        </div>
      ))}
      {list.hasNextPage && !list.isFetchNextPageError && <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{words.older}</Button>}
    </section>
  )
  const preview = target === null ? undefined : {
    body: (
      <div className={styles.revisionPreview} aria-label={words.comparison}>
        {comparison.isPending ? <QueryLoading label={words.loading} /> : comparison.isError ? (
          <QueryFailedLine retryLabel={retry} onRetry={refresh}>{words.diffFailed}</QueryFailedLine>
        ) : record && <>
          <p>{words.direction(record.currentRevision, record.targetRevision)}</p>
          {record.changes.length > 0 ? <Diff from={diffText(record, 'before')} to={diffText(record, 'after')}
            label={words.comparison} compact /> : <p>{words.noChanges}</p>}
          {record.protectedConfigChanged && <p role="status">{words.protected}</p>}
        </>}
        {notice && <p role="alert">{notice}</p>}
      </div>
    ),
    footer: (
      <>
        <span className={styles.revisionDraft}>{dirty ? words.draftKept : words.guide}</span>
        <Button onClick={() => select(null)}>{words.back}</Button>
        <Button variant="warn" disabled={!canRestore} onClick={() => {
          if (!canRestore) return
          restore.reset()
          setAsk(record)
        }}>{words.restore}</Button>
      </>
    ),
  }
  const code = isApiError(restore.error) ? restore.error.code : null
  const error = code === 'PROFILE_REVISION_PROTECTED' || code === 'PROFILE_REVISION_INCOMPATIBLE'
    ? words.refused : restore.error && failureText(restore.error, locale)
  const dialog = ask && (
    <Confirm title={words.confirm(ask.targetRevision)} tone="warn" labels={{ confirm: words.restore, cancel }}
      onConfirm={() => void confirm()}
      onClose={() => { if (!restore.isPending) setAsk(null) }}
      state={{ busy: restore.isPending, error }}>
      <p>{words.confirmBody(ask.currentRevision)}</p>
      <p>{words.panelOnly}</p>
      {ask.protectedConfigChanged && <p>{words.protected}</p>}
      {dirty && <p>{words.discardDraft}</p>}
    </Confirm>
  )
  return { button, rail, preview, dialog, restoring: restore.isPending, clear: () => select(null) }
}
