import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MatchInput } from '@/contours/traffic/components/MatchInput'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useCascadesList, useDeleteRoutePolicy, useSaveRoutePolicy } from '@/contours/traffic/hooks/useRoutes'
import { refusedTokens } from '@/contours/traffic/lib/ownLists'
import { isEmptyPolicy, isUntouched, routePolicyBody } from '@/contours/traffic/lib/routeBody'
import { findShadows, NEW_POLICY_ID, POLICY_ACTIONS, splitMatch, toRules, type DraftRule } from '@/contours/traffic/lib/routeRules'
import { DICT } from '@/contours/traffic/routesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { conflictField } from '@/lib/old/conflictField'
import { policyEntryOf, policyEntryUnknown, routePolicyInUse, unknownInMatch, type RouteAction, type RoutePolicy } from '@/lib/old/routePolicies'
import type { Squad } from '@/lib/old/squads'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const NAME_FIELDS = ['name', 'ordinal'] as const

export interface RoutePolicyEditorProps {
  policy: RoutePolicy
  squads: readonly Squad[]
  onDone: (id?: string) => void
  onOpenNodePolicies: () => void
}

/** The server stores two lists and the node renders block above direct whatever the rows say, so two actions and no order. */
export function RoutePolicyEditor({ policy, squads, onDone, onOpenNodePolicies }: RoutePolicyEditorProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const isNew = policy.id === NEW_POLICY_ID
  const save = useSaveRoutePolicy(isNew ? null : policy.id)
  const remove = useDeleteRoutePolicy()
  const cascades = useCascadesList()
  const nextKey = useRef(0)
  const initial = useMemo(() => toRules(policy), [policy])
  const [name, setName] = useState(policy.name)
  const [rules, setRules] = useState<DraftRule[]>(initial)
  const [unknown, setUnknown] = useState<string[]>([])
  const [nameTaken, setNameTaken] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [inUse, setInUse] = useState<readonly { id: string; name: string }[] | null>(null)
  const shadows = useMemo(() => findShadows(rules), [rules])
  const body = routePolicyBody(policy, name, rules)
  const untouched = isUntouched(body)
  const empty = isEmptyPolicy(rules)
  const hasRefused = rules.some((rule) => refusedTokens(rule.match).length > 0)
  const granted = squads.filter((s) => s.policyIds.includes(policy.id))
  const entryNames = policyEntryOf(policy.id, cascades.data?.cascades, cascades.data?.fields)
  const entryCascades = (cascades.data?.cascades ?? []).filter((c) => entryNames?.includes(c.name))
  const setRule = (i: number, next: Partial<DraftRule>) => {
    if (next.match) setUnknown([])
    setFailure(null)
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)))
  }
  const send = () => {
    if (!body) return
    setFailure(null)
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.show(words.savedPolicy)
        onDone(saved.id)
      },
      onError: (err) => {
        const entries = policyEntryUnknown(err)
        if (entries) {
          setUnknown(entries)
          return
        }
        const taken = conflictField(err, NAME_FIELDS)
        if (taken?.field === 'name') setNameTaken(taken.message || failureText(err, locale))
        else setFailure(failureText(err, locale))
      },
    })
  }
  const confirmDelete = () => {
    setDeleteError(null)
    remove.mutate(policy.id, {
      onSuccess: () => {
        toast.show(words.deletedPolicy)
        onDone()
      },
      onError: (err) => {
        const held = routePolicyInUse(err)
        if (held) {
          setAsking(false)
          setInUse(held.cascades)
        } else setDeleteError(failureText(err, locale))
      },
    })
  }
  const blocked = inUse ?? (entryCascades.length > 0 ? entryCascades : null)
  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        <div className={styles.nameField}>
          <Input
            aria-label={words.policyName}
            aria-invalid={nameTaken !== null || undefined}
            placeholder={words.policyName}
            value={name}
            onChange={(e) => {
              setNameTaken(null)
              setName(e.target.value)
            }}
          />
          {nameTaken && <p className={styles.danger}>{nameTaken}</p>}
        </div>
        {!isNew && (
          <span className={styles.chip} title={words.bandFixed}>
            {words.tag(policy.ordinal)}
          </span>
        )}
        {!untouched && !empty && <span className={styles.amber}>{words.unsaved}</span>}
        <span className={styles.spacer} />
        {!isNew && (
          <Button variant="danger" onClick={() => (entryCascades.length > 0 ? setInUse(entryCascades) : setAsking(true))}>
            {words.deleteAction}
          </Button>
        )}
        <Button variant="primary" loading={save.isPending} disabled={!body || untouched || hasRefused} title={words.saveReaches} onClick={send}>
          {words.save}
        </Button>
      </div>
      <p className={styles.noteRow}>{words.blockAboveDirect}</p>
      {failure && <Banner tone="danger">{failure}</Banner>}
      <div className={styles.rules}>
        <div className={styles.ruleHead}>
          <span>{words.colIf}</span>
          <span>{words.colSend}</span>
          <span>{words.colOverlap}</span>
        </div>
        <div className={styles.ruleLocked}>
          <span className={styles.lockCell}>
            <Icon name="lock" size="sm" />
            {words.hygieneMatch}
          </span>
          <span>{words.hygieneAction}</span>
          <span className={styles.note}>{words.hygieneNote}</span>
        </div>
        {rules.map((rule, i) => {
          const shadow = shadows.get(rule.id)
          const bad = unknownInMatch(rule.match, unknown)
          const refused = refusedTokens(rule.match)
          return (
            <div key={rule.id} className={shadow ? styles.ruleShadowed : styles.rule}>
              <MatchInput label={words.matchField} placeholder={words.matchHolder} value={rule.match.join(' ')} bad={bad.length > 0 || refused.length > 0} shadowed={Boolean(shadow)} onChange={(line) => setRule(i, { match: splitMatch(line) })} />
              <Select aria-label={words.actionField} value={rule.action} onChange={(e) => setRule(i, { action: e.target.value as RouteAction })} options={POLICY_ACTIONS.map((a) => ({ value: a, label: words.policyAction[a] }))} />
              <div className={styles.ruleNote}>
                {shadow && <span className={styles.amber}>{shadow.by === 'block' ? words.shadowedByBlock(shadow.match) : words.shadowedTwice(shadow.match)}</span>}
                {bad.length > 0 && <span className={styles.danger}>{words.entryUnknownRow(bad.join(', '))}</span>}
                {refused.length > 0 && <span className={styles.danger}>{words.tokenRefused(refused.join(', '))}</span>}
              </div>
              <Button size="sm" onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}>
                {words.remove}
              </Button>
            </div>
          )
        })}
        {/* F-10: the reason stands in the table, where the rows would be. */}
        {empty && <p className={styles.ruleEmpty}>{words.emptyPolicy}</p>}
        <div className={styles.ruleAdd}>
          <Button
            size="sm"
            icon={<Icon name="plus" size="sm" />}
            onClick={() => {
              nextKey.current += 1
              setRules((prev) => [...prev, { id: `new-${nextKey.current}`, match: [], action: 'direct', note: '' }])
            }}
          >
            {words.addRule}
          </Button>
          <p className={styles.note}>{words.entryGrammar}</p>
          <p className={styles.note}>
            {words.warpElsewhere}{' '}
            <button type="button" className={styles.textButton} onClick={onOpenNodePolicies}>
              {words.openNodePolicies}
            </button>
          </p>
        </div>
        <div className={styles.ruleLocked}>
          <span className={styles.lockCell}>
            <Icon name="geo" size="sm" />
            {words.everythingElse}
          </span>
          <span>{words.nodeDoor}</span>
          <span className={styles.note}>{words.nodeDoorNote}</span>
        </div>
      </div>
      {asking && (
        <Confirm title={words.deleteTitle(policy.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setAsking(false)}>
          <p>{granted.length > 0 ? words.deleteGranted(granted.length) : words.deleteSafe}</p>
        </Confirm>
      )}
      {!asking && inUse && blocked && (
        <Dialog title={words.blockedTitle} closeLabel={words.close} onClose={() => setInUse(null)} footer={<Button onClick={() => setInUse(null)}>{words.close}</Button>}>
          <p>{words.blockedBody}</p>
          <ul className={styles.linkList}>
            {blocked.map((c) => (
              <li key={c.id}>
                <Link className={styles.link} to={`/cascades/${c.id}`}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </section>
  )
}
