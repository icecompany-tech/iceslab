import { useState } from 'react'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { useBindingsAll, useDeleteCascade, useOldSquads, useRoutePolicies } from '@/contours/cascades/hooks/useCascades'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeMembers } from '@/lib/old/cascadeMembership'
import { cascadeReach } from '@/lib/old/cascadePath'
import { cascadeDeleteRefusal, type Cascade } from '@/lib/old/cascades'
import { cascadeShape } from '@/contours/cascades/lib/shape'
import { Confirm } from '@/ui/Dialog/Confirm'
import { useToast } from '@/ui/Toast/useToast'

/** F-K6: the price in words before the question: who leaves the cascade for the entry country. */
export function EntryAskWindow({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { ask } = form
  if (!ask) return null
  const change = ask.kind === 'entryChange'
  return (
    <Confirm
      title={change ? (ask.asked.from && ask.asked.to ? words.entryDropTitle(ask.asked.from, ask.asked.to) : words.entryDropTitleBare) : words.entryNodesTitle}
      labels={{ confirm: change ? words.entryDropConfirm : words.entryNodesConfirm, cancel: words.cancel }}
      tone="danger"
      state={{ busy: form.saving, error: null }}
      onConfirm={form.agree}
      onClose={form.dismissAsk}
    >
      <p>{words.entryDropBody}</p>
      <ul className={styles.plainList}>
        {change
          ? ask.asked.conflicts.map((c) => <li key={`${c.nodeName}-${c.profileName}`}>{words.entryDropRow(c.profileName, c.nodeName)}</li>)
          : ask.groups.map((g) => <li key={g.nodeName}>{words.entryNodesRow(g.nodeName, g.profiles.join(', '))}</li>)}
      </ul>
    </Confirm>
  )
}

/** F-K6: names the squads and the users that lose lines, and that the tags burn; the side lists not arriving is said as that. */
export function DeleteWindow({ cascade, onClose, onDeleted }: { cascade: Cascade; onClose: () => void; onDeleted: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const remove = useDeleteCascade()
  const bindings = useBindingsAll()
  const squads = useOldSquads()
  const policies = useRoutePolicies()
  const [error, setError] = useState<string | null>(null)
  const reach = cascadeReach(cascadeShape(cascade).entryNodeIds, bindings.data?.bindings, squads.data?.squads, policies.data?.policies)
  const tags = cascade.directions.map((d) => d.tag)
  const confirm = () => {
    setError(null)
    remove.mutate(cascade.id, {
      onSuccess: () => {
        toast.show(words.deleted)
        onDeleted()
      },
      onError: (err) => {
        const refusal = cascadeDeleteRefusal(err)
        if (refusal?.kind === 'gone') {
          toast.show(words.alreadyDeleted)
          onDeleted()
          return
        }
        setError(refusal ? `${words.deleteRefused} ${refusal.message}` : failureText(err, locale))
      },
    })
  }
  return (
    <Confirm title={words.deleteTitle(cascade.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error }} onConfirm={confirm} onClose={onClose}>
      <p>{words.deleteBody(cascadeMembers(cascade).length)}</p>
      <p>{reach === null ? words.deleteReachUnknown : reach.squads.length === 0 ? words.deleteReachNone : words.deleteReach(reach.squads.map((s) => `${s.name} (${fmtNumber(s.members, locale)})`).join(', '), fmtNumber(reach.users, locale))}</p>
      {tags.length > 0 && <p>{words.deleteTags(tags.join(', '))}</p>}
    </Confirm>
  )
}
