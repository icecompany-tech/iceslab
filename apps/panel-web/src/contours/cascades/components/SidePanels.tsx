import { useState } from 'react'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { useCascadeStatus, useRotateTunnels } from '@/contours/cascades/hooks/useCascades'
import { lastAttemptFacts } from '@/contours/cascades/lib/cascadeForm'
import { allNodeIds, subscriberRows, type SubscriberRow } from '@/contours/cascades/lib/draft'
import { tunnelNotFound, tunnelRows, type TunnelRow } from '@/contours/cascades/lib/tunnels'
import { nodeHealth } from '@/lib/domain/overview'
import { fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeStatusView, hopBroken } from '@/lib/old/cascadeStatus'
import type { Cascade } from '@/lib/old/cascades'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

export function SubscribersPanel({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { draft } = form
  const rows = subscriberRows(draft, (id) => form.nodeById.get(id)?.name, { awg31: form.entry.awg31, failed: form.entry.failed })
  const line = (row: SubscriberRow): { text: string; note: string } => {
    switch (row.kind) {
      case 'awg':
        return { text: `${words.subAwg}${row.awg31 ? ' · 3.1' : ''}`, note: row.unknown ? words.subAwgFailed : '' }
      case 'auto':
        return { text: words.subAuto(draft.name), note: words.subTagAuto }
      case 'direction':
        return { text: words.subVia(draft.name, row.where), note: words.subTag(row.tag) }
      case 'direct':
        return { text: row.name, note: words.subDirect }
    }
  }
  const hint = draft.pools[0]?.entryProtocol === 'amneziawg' ? words.subHintAwg : draft.directions.length > 1 ? words.subHintMany : words.subHintOne
  return (
    <section className={styles.panel}>
      <h3 className={styles.panelTitle}>{words.subTitle}</h3>
      {!draft.enabled && <p className={styles.note}>{words.subDisabled}</p>}
      {draft.enabled && rows.length === 0 && <p className={styles.note}>{words.subNone}</p>}
      {draft.enabled && rows.length > 0 && (
        <ul className={styles.plainList}>
          {rows.map((row, i) => {
            const { text, note } = line(row)
            return (
              <li key={`${text}-${i}`} className={styles.listRow}>
                <span>{text}</span>
                <span className={styles.note}>{note}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className={styles.note}>{hint}</p>
    </section>
  )
}

/** F-V6: «the core refused» and «the node did not answer» are separate here, on the scheme and in the banner. No retry: the push repeats with the next edit. */
export function PushPanel({ form, cascade }: { form: CascadeForm; cascade: Cascade }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const status = useCascadeStatus(cascade.id, cascade.enabled)
  const view = cascadeStatusView(status.data)
  const attempt = lastAttemptFacts(status.data?.hops ?? [], new Map(form.nodeById))
  const when = (iso: string) => fmtDateTime(iso, locale)
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>{words.pushTitle}</h3>
        <span className={styles.note}>{words.savedAt(when(cascade.updatedAt))}</span>
      </div>
      {!cascade.enabled && <p className={styles.note}>{words.pushOff}</p>}
      {cascade.enabled && status.isPending && <QueryLoading label={words.pushLoading} />}
      {cascade.enabled && status.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void status.refetch()}>
          {`${words.pushFailed}: ${failureText(status.error, locale)}`}
        </QueryFailedLine>
      )}
      {cascade.enabled && status.data && (
        <>
          {attempt && <p className={attempt.refused > 0 ? styles.danger : styles.note}>{attempt.refused > 0 ? words.attemptBad(when(attempt.at), attempt.refused, attempt.answered) : words.attemptOk(when(attempt.at))}</p>}
          {view.kind === 'done' && <p className={styles.note}>{words.pushDone}</p>}
          {view.kind === 'pending' && <p className={styles.amber}>{view.waiting.length > 0 ? words.pushPending(view.waiting.join(', ')) : words.pushNobody}</p>}
          <ul className={styles.plainList}>
            {status.data.hops.map((hop) => {
              const broken = hopBroken(hop)
              const node = form.nodeById.get(hop.nodeId)
              const lost = !hop.online || (node !== undefined && nodeHealth(node.status) === 'problem')
              return (
                <li key={hop.nodeId} className={styles.hopLine}>
                  <span className={styles.listRow}>
                    <span>{hop.name}</span>
                    <span className={lost && !hop.applied ? styles.danger : styles.note}>{hop.applied ? words.hopApplied : lost ? words.hopOffline : words.hopWaiting}</span>
                  </span>
                  {broken && <span className={lost ? styles.note : styles.danger}>{lost ? words.hopLastWords(broken) : words.hopCore(broken)}</span>}
                </li>
              )
            })}
          </ul>
          <p className={styles.note}>{words.pushNote(allNodeIds(form.draft).length)}</p>
        </>
      )}
    </section>
  )
}

export function TunnelsPanel({ form, cascade }: { form: CascadeForm; cascade: Cascade }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const rotate = useRotateTunnels(cascade.id)
  const { rows, openPorts } = tunnelRows(cascade.tunnels, form.nodeById)
  const [asking, setAsking] = useState<TunnelRow | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (rows.length === 0) return null
  const row = asking === 'all' ? null : asking
  const confirm = () => {
    setError(null)
    rotate.mutate(row ? { fromNodeId: row.fromNodeId, toNodeId: row.toNodeId } : undefined, {
      onSuccess: () => {
        setAsking(null)
        toast.show(row ? words.tunnelRotated : words.tunnelsRotated)
      },
      onError: (err) => setError(tunnelNotFound(err) !== null ? words.tunnelGone : failureText(err, locale)),
    })
  }
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>{words.tunnelsTitle}</h3>
        {rows.length > 1 && (
          <Button size="sm" variant="warn" onClick={() => setAsking('all')}>
            {words.tunnelsRotateAll}
          </Button>
        )}
      </div>
      <ul className={styles.plainList}>
        {rows.map((r) => (
          <li key={r.key} className={styles.listRow}>
            <span className={styles.hopLine}>
              <span>{words.legOf(r.fromName, r.toName)}</span>
              <span className={styles.note}>
                {r.iface} · {r.network} · {words.tunnelPort(r.port)}
              </span>
            </span>
            <Button size="sm" variant="warn" onClick={() => setAsking(r)}>
              {words.tunnelRotate}
            </Button>
          </li>
        ))}
      </ul>
      {openPorts.map((name) => (
        <p key={name} className={styles.amber}>
          {words.tunnelPortOpen(name)}
        </p>
      ))}
      <p className={styles.note}>{words.tunnelsHint}</p>
      {asking !== null && (
        <Confirm
          title={row ? words.tunnelRotateTitle(row.fromName, row.toName) : words.tunnelsRotateTitle(rows.length)}
          labels={{ confirm: words.tunnelRotate, cancel: words.cancel }}
          tone="warn"
          state={{ busy: rotate.isPending, error }}
          onConfirm={confirm}
          onClose={() => setAsking(null)}
        >
          <p>{row ? words.tunnelRotateBody : words.tunnelsRotateBody}</p>
        </Confirm>
      )}
    </section>
  )
}
