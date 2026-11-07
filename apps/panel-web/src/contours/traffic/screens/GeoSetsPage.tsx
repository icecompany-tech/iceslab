import { useRef, useState } from 'react'
import { AddUrlWindow, InUseWindow, RolloutWindow, UploadWindow } from '@/contours/traffic/components/GeoWindows'
import styles from '@/contours/traffic/components/traffic.module.css'
import { DICT } from '@/contours/traffic/geoDict'
import { useAllNodes, useDeleteSet, useGeoSetList, useRefreshSet, useReplaceFile } from '@/contours/traffic/hooks/useGeoSets'
import { geoAttention, geoScreenFacts, geoSetActions, geoSetState, uploadProblem } from '@/contours/traffic/lib/geoFacts'
import { useNow } from '@/lib/clock'
import { fmtAge } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { geoSetRefusal, isNotImplemented, nodeGeoFacts, type GeoSet, type GeoUse } from '@/lib/old/geoSets'
import { loadView } from '@/lib/old/loadView'
import { nodeFieldKnown } from '@/lib/old/nodeFields'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Icon } from '@/ui/Icon/Icon'
import { Menu, type MenuItem } from '@/ui/Menu/Menu'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

type Adding = 'url' | 'upload' | null

const MS_IN_SECOND = 1000

export default function GeoSetsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const now = useNow()
  const list = useGeoSetList()
  const nodes = useAllNodes()
  const refresh = useRefreshSet()
  const replace = useReplaceFile()
  const remove = useDeleteSet()
  const [adding, setAdding] = useState<Adding>(null)
  const [rollingOut, setRollingOut] = useState<GeoSet | null>(null)
  const [deleting, setDeleting] = useState<GeoSet | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [held, setHeld] = useState<readonly GeoUse[] | null>(null)
  const [replacing, setReplacing] = useState<GeoSet | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const unavailable = isNotImplemented(list.error)
  const facts = geoScreenFacts({ ...(list.data ? { sets: list.data.geoSets } : {}), notImplemented: unavailable, failed: list.isError })
  // Counted off the node cards, not the sum of `nodes.behind`: one node behind on two sets is one node.
  const geoKnown = nodeFieldKnown(nodes.data, 'geo')
  const nodesView = loadView(nodes)
  const nodesBehind = nodesView === 'ready' ? (nodes.data?.nodes ?? []).filter((n) => nodeGeoFacts(n, geoKnown)?.state === 'behind').length : nodesView
  const attention = facts.state === 'list' ? geoAttention(facts.sets, nodesBehind) : null
  const refusalText = (err: unknown) => {
    const read = geoSetRefusal(err)
    if (read?.code === 'GEO_SET_INVALID' && read.reason) return words.invalid[read.reason] ?? read.message ?? read.reason
    return read?.message ?? failureText(err, locale)
  }
  const startRefresh = (set: GeoSet) =>
    refresh.mutate(set.id, {
      onSuccess: () => toast.show(words.refreshSent),
      onError: (err) => toast.show(`${words.refreshFailed}: ${refusalText(err)}`, 'failed'),
    })
  const startReplace = (set: GeoSet, picked: File) => {
    if (uploadProblem(picked) === 'too-large') {
      toast.show(words.tooLarge, 'failed')
      return
    }
    replace.mutate(
      { id: set.id, file: picked },
      {
        onSuccess: (next) => {
          if (next.status === 'broken') toast.show(words.replacedBroken(next.name, next.error ?? words.noError), 'failed')
          else toast.show(words.replaced(next.name))
        },
        onError: (err) => toast.show(`${words.uploadFailed}: ${refusalText(err)}`, 'failed'),
      },
    )
  }
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.show(words.deleted)
        setDeleting(null)
      },
      onError: (err) => {
        const read = geoSetRefusal(err)
        if (read?.code === 'GEO_SET_IN_USE') {
          setDeleting(null)
          setHeld(read.uses)
        } else setDeleteError(refusalText(err))
      },
    })
  }
  const menuItems = (set: GeoSet): MenuItem[] => {
    const actions = geoSetActions(set)
    const blocked = actions.deleteBlocked
    return [
      ...(actions.refresh ? [{ id: 'refresh', label: words.refresh, icon: 'rotateLeft' as const, onSelect: () => startRefresh(set) }] : []),
      ...(actions.replaceFile
        ? [
            {
              id: 'replace',
              label: words.replaceFile,
              icon: 'copy' as const,
              onSelect: () => {
                setReplacing(set)
                file.current?.click()
              },
            },
          ]
        : []),
      { id: 'rollout', label: words.rolloutAction, icon: 'arrowRight', ...(actions.rollout ? {} : { disabledReason: words.noVersionToSend }), onSelect: () => setRollingOut(set) },
      {
        id: 'delete',
        label: words.delete,
        icon: 'trash',
        tone: 'danger',
        divider: true,
        ...(blocked === 'builtin' ? { disabledReason: words.deleteBlocked.builtin } : {}),
        ...(blocked === 'checking' ? { disabledReason: words.deleteBlocked.checking } : {}),
        ...(blocked === 'used' ? { disabledReason: words.deleteBlocked.used(set.usedByRules) } : {}),
        onSelect: () => {
          setDeleteError(null)
          setDeleting(set)
        },
      },
    ]
  }
  const sourceWords = (set: GeoSet) => {
    switch (set.source.type) {
      case 'builtin':
        return words.sourceBuiltin(set.source.tag)
      case 'url':
        return set.source.sha256Source === 'manual' ? words.sourceUrlManual(set.source.url, set.source.refreshHours) : words.sourceUrl(set.source.url, set.source.refreshHours)
      case 'upload':
        return words.sourceUpload(set.source.filename)
    }
  }
  const stateNote = (set: GeoSet) => {
    const state = geoSetState(set)
    switch (state) {
      case 'broken-empty':
        return <p className={styles.danger}>{words.brokenEmpty(set.error ?? words.noError)}</p>
      case 'broken-update':
        return <p className={styles.danger}>{words.brokenUpdate(set.error ?? words.noError, set.current?.version ?? '')}</p>
      case 'checking':
        return <p className={styles.note}>{set.current ? words.checkingOver(set.current.version) : words.checkingFirst}</p>
      case 'verified':
        return null
    }
  }
  const checkedAt = (at: string) => {
    const seconds = Math.max(0, (now() - new Date(at).getTime()) / MS_IN_SECOND)
    return words.fetched(fmtAge(seconds, locale))
  }
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.intro}>
          <p className={styles.noteRow}>{words.intro}</p>
          {facts.state === 'list' && <p className={styles.note}>{words.count(facts.total)}</p>}
        </div>
        <div className={styles.actions}>
          <Button icon={<Icon name="plus" size="md" />} disabled={unavailable} onClick={() => setAdding('url')}>
            {words.addUrl}
          </Button>
          <Button icon={<Icon name="plus" size="md" />} disabled={unavailable} onClick={() => setAdding('upload')}>
            {words.upload}
          </Button>
        </div>
      </div>
      {attention && (attention.broken.length > 0 || attention.nodesBehind > 0) && (
        <Banner tone={attention.broken.length > 0 ? 'danger' : 'warn'}>
          {attention.broken.length > 0 && <div>{words.attentionBroken(attention.broken.join(', '))}</div>}
          {attention.nodesBehind > 0 && <div>{words.attentionBehind(attention.nodesBehind)}</div>}
        </Banner>
      )}
      {attention?.nodesFailed && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void nodes.refetch()}>
          {words.attentionNodesFailed(failureText(nodes.error, locale))}
        </QueryFailedLine>
      )}
      {facts.state === 'unavailable' && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.soonTitle}</h2>
          <p>{words.soonBody}</p>
        </div>
      )}
      {facts.state === 'loading' && <QueryLoading label={words.loading} />}
      {facts.state === 'failed' && <QueryFailed title={words.failed} body={failureText(list.error, locale)} retryLabel={words.retry} onRetry={() => void list.refetch()} />}
      {facts.state === 'empty' && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
        </div>
      )}
      {facts.state === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{words.colName}</th>
                <th>{words.colState}</th>
                <th>{words.colVersion}</th>
                <th>{words.colUsed}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {facts.sets.map((set) => {
                const state = geoSetState(set)
                const current = set.current
                return (
                  <tr key={set.id}>
                    <td>
                      <div>{set.name}</div>
                      <div className={styles.note}>{`${set.kind} · ${set.format}`}</div>
                      <div className={styles.note}>{sourceWords(set)}</div>
                    </td>
                    <td>
                      <div className={state === 'verified' ? styles.ok : state === 'checking' ? styles.amber : styles.danger}>{words.status[state]}</div>
                      {stateNote(set)}
                    </td>
                    <td>
                      {/* The sum as the file came, the one the operator can compare with their own. */}
                      <div className={current ? styles.mono : styles.note} title={current ? `sha256 ${current.sourceSha256 ?? current.sha256}` : undefined}>
                        {current ? current.version : words.noCurrent}
                      </div>
                      {current && <div className={styles.note}>{`${checkedAt(current.fetchedAt)} · ${words.tags(current.tagCount)}`}</div>}
                    </td>
                    <td>
                      <div>{words.usedByRules(set.usedByRules)}</div>
                      <div className={set.nodes.behind > 0 ? styles.amber : styles.note} title={set.nodes.behind > 0 ? words.nodesBehindHint : undefined}>
                        {set.nodes.behind > 0 ? words.nodesBehind(set.nodes.behind, set.nodes.total) : words.nodesTotal(set.nodes.total)}
                      </div>
                    </td>
                    <td>
                      <div className={styles.rowMenu}>
                        <Menu label={words.rowMenu(set.name)} items={menuItems(set)} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <input
        ref={file}
        className={styles.hiddenInput}
        type="file"
        accept=".dat,.json,.mmdb"
        aria-label={replacing ? words.replaceField(replacing.name) : words.replaceFile}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked && replacing) startReplace(replacing, picked)
        }}
      />
      {adding === 'url' && <AddUrlWindow onClose={() => setAdding(null)} />}
      {adding === 'upload' && <UploadWindow onClose={() => setAdding(null)} />}
      {rollingOut && <RolloutWindow set={rollingOut} onClose={() => setRollingOut(null)} />}
      {deleting && (
        <Confirm title={words.deleteTitle(deleting.name)} labels={{ confirm: words.delete, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{words.deleteBody}</p>
        </Confirm>
      )}
      {held && <InUseWindow uses={held} onClose={() => setHeld(null)} />}
    </div>
  )
}
