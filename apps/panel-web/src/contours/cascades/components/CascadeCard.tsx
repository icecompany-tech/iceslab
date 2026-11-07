import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DeleteWindow } from '@/contours/cascades/components/CascadeWindows'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import { useToggleCascade } from '@/contours/cascades/hooks/useCascades'
import { MAX_POSITIONS } from '@/contours/cascades/lib/cascadeForm'
import type { CascadeRow } from '@/contours/cascades/lib/rows'
import { fmtBytes, fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeToggleRefusal, nodeInOtherCascadeRefusal } from '@/lib/old/cascades'
import { Button } from '@/ui/Button/Button'
import { CascadeFlow } from '@/ui/CascadeFlow/CascadeFlow'
import { Confirm } from '@/ui/Dialog/Confirm'
import { HopMeter } from '@/ui/HopMeter/HopMeter'
import { Switch } from '@/ui/Switch/Switch'

/** Never flips before the server answers: a refusal keeps it drawn as off, with the reason under it and the way to the node. */
export function CascadeCard({ row }: { row: CascadeRow }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toggle = useToggleCascade()
  const [refused, setRefused] = useState<{ text: string; nodeId: string | null } | null>(null)
  const [askOff, setAskOff] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { cascade, flow, hops, reach, today, push, nodeNames } = row

  const nodeIdInWords = (text: string) => nodeNames.find((n) => text.includes(n.name))?.id ?? null
  const send = (enabled: boolean) => {
    setRefused(null)
    toggle.mutate(
      { id: cascade.id, enabled },
      {
        onSuccess: () => setAskOff(false),
        onError: (err) => {
          setAskOff(false)
          const taken = nodeInOtherCascadeRefusal(err)
          const said = cascadeToggleRefusal(err)
          const text = taken ? words.otherCascade(taken.nodeName, taken.cascadeName) : (said?.message ?? failureText(err, locale))
          setRefused({ text, nodeId: nodeIdInWords(text) })
        },
      },
    )
  }
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <Link className={styles.cardName} to={`/cascades/${cascade.id}`}>
          {cascade.name}
        </Link>
        <HopMeter count={hops} max={MAX_POSITIONS} label={words.hopMeter(hops, MAX_POSITIONS)} />
        <span className={styles.spacer} />
        <Switch label={cascade.enabled ? words.stateOn : words.stateOff} checked={cascade.enabled} disabled={toggle.isPending} onChange={(on) => (on ? send(true) : setAskOff(true))} />
        <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
          {words.deleteAction}
        </Button>
      </div>
      {push.kind === 'broken' && <p className={styles.danger}>{`${words.brokenBanner}: ${push.broken}`}</p>}
      <div className={cascade.enabled ? undefined : styles.cardOff}>
        <CascadeFlow label={words.flowLabel(cascade.name)} columns={flow.columns} links={flow.links} {...(flow.legend ? { legend: flow.legend } : {})} />
      </div>
      <div className={styles.cardFacts}>
        <span>
          {words.colReach}: {reach === null ? '?' : reach.squads.length === 0 ? words.reachNobody : words.reachSquads(reach.squads.map((s) => s.name).join(', '), fmtNumber(reach.users, locale))}
        </span>
        {today !== null && <span>{words.today(fmtBytes(today, locale))}</span>}
        {push.kind === 'done' && <span>{words.pushDone}</span>}
        {push.kind === 'pending' && push.waiting.length > 0 && <span className={styles.amber}>{words.pushPending(push.waiting.join(', '))}</span>}
      </div>
      {refused && (
        <p className={styles.danger}>
          {words.enableRefused} {refused.text}{' '}
          {refused.nodeId && (
            <Link className={styles.link} to={`/nodes/${refused.nodeId}`}>
              {words.openNode}
            </Link>
          )}
        </p>
      )}
      {askOff && (
        <Confirm title={words.offTitle(cascade.name)} labels={{ confirm: words.offConfirm, cancel: words.cancel }} tone="warn" state={{ busy: toggle.isPending, error: null }} onConfirm={() => send(false)} onClose={() => setAskOff(false)}>
          <p>{words.offBody}</p>
        </Confirm>
      )}
      {deleting && <DeleteWindow cascade={cascade} onClose={() => setDeleting(false)} onDeleted={() => setDeleting(false)} />}
    </article>
  )
}
