import { useRef, useState } from 'react'
import { MatchInput } from '@/contours/traffic/components/MatchInput'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useDeleteNodePolicy, useGeoSets, useSaveNodePolicy } from '@/contours/traffic/hooks/useRoutes'
import { ACTION_KEY, ACTION_ORDER } from '@/contours/traffic/lib/nodePolicyActions'
import { nodeCountOf, nodeCountWords } from '@/contours/traffic/lib/nodePolicyCount'
import { extraMatchers, matchTokens, parseTokens } from '@/contours/traffic/lib/nodePolicyMatch'
import { refusedTokens } from '@/contours/traffic/lib/ownLists'
import { isUntouched, NEW_NODE_POLICY_ID, nodePolicyBody } from '@/contours/traffic/lib/routeBody'
import { DICT, sayer } from '@/contours/traffic/routesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { policyRefusal, type NodePolicy, type PolicyActionKind, type PolicyRule } from '@/lib/old/nodePolicies'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

export interface DirectionOption {
  id: string
  cascade: string
  where: string
}

export interface NodePolicyEditorProps {
  policy: NodePolicy
  directions: readonly DirectionOption[]
  onDone: (id?: string) => void
}

const CASCADE_PREFIX = 'cascade:'

function actionValue(rule: PolicyRule): string {
  return rule.action.kind === 'cascade' ? `${CASCADE_PREFIX}${rule.action.directionId ?? ''}` : rule.action.kind
}

function actionOf(value: string): PolicyRule['action'] {
  if (value.startsWith(CASCADE_PREFIX)) return { kind: 'cascade', directionId: value.slice(CASCADE_PREFIX.length) || null, directionLabel: null }
  return { kind: value as Exclude<PolicyActionKind, 'cascade'>, directionId: null }
}

/**
 * One policy as the three stages it really is: protection, the operator's rules, the door out.
 * Only the middle is data; the ends are drawn because the list is read as one sequence.
 */
export function NodePolicyEditor({ policy, directions, onDone }: NodePolicyEditorProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const say = sayer(words)
  const isNew = policy.id === NEW_NODE_POLICY_ID
  const save = useSaveNodePolicy(isNew ? null : policy.id)
  const remove = useDeleteNodePolicy()
  const { kinds } = useGeoSets()
  const nextKey = useRef(0)
  const [name, setName] = useState(policy.name)
  const [rules, setRules] = useState<PolicyRule[]>(policy.rules)
  const [refusal, setRefusal] = useState<{ message: string; policies?: string[] } | null>(null)
  const [asking, setAsking] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const count = nodeCountWords(nodeCountOf(policy), say)
  const body = nodePolicyBody(policy, name, rules)
  const untouched = isUntouched(body)
  const refusedIn = (rule: PolicyRule) => refusedTokens(matchTokens(rule.match))
  const hasRefused = rules.some((rule) => refusedIn(rule).length > 0)
  const setRule = (i: number, next: PolicyRule) => {
    setRefusal(null)
    setRules((prev) => prev.map((r, j) => (j === i ? next : r)))
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return
    setRefusal(null)
    setRules((prev) => {
      const next = [...prev]
      const [row] = next.splice(from, 1)
      if (row) next.splice(to, 0, row)
      return next
    })
  }
  /** A local edit makes the server's verdict about other text: it is shown only for rows as they came. */
  const shadowNote = (rule: PolicyRule) => {
    if (!rule.shadowedBy) return null
    const culprit = rules.find((r) => r.id === rule.shadowedBy?.id)
    if (!culprit) return null
    const tokens = [...culprit.match.domain, ...culprit.match.ip]
    return words.nodeShadowed(tokens.length > 0 ? tokens.join(', ') : words.nodeAnything)
  }
  const send = () => {
    if (!body) return
    setRefusal(null)
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.show(words.savedPolicy)
        onDone(saved.id)
      },
      onError: (err) => {
        const read = policyRefusal(err)
        setRefusal(read ? { message: read.message, ...(read.policies ? { policies: read.policies } : {}) } : { message: failureText(err, locale) })
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
      onError: (err) => setDeleteError(policyRefusal(err)?.message ?? failureText(err, locale)),
    })
  }
  const actionOptions = (rule: PolicyRule) => {
    const known = directions.map((d) => ({ value: `${CASCADE_PREFIX}${d.id}`, label: words.directionWord(d.cascade, d.where) }))
    const current = actionValue(rule)
    const stray = rule.action.kind === 'cascade' && !known.some((o) => o.value === current) ? [{ value: current, label: rule.action.directionLabel ?? words.nodeAction.viaDirection }] : []
    return [...ACTION_ORDER.filter((k) => k !== 'cascade').map((k) => ({ value: k as string, label: words.nodeAction[ACTION_KEY[k]] })), ...stray, ...known]
  }
  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        <div className={styles.nameField}>
          <Input aria-label={words.policyName} placeholder={words.policyName} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!isNew && <span className={styles.chip}>{count.chip}</span>}
        {!untouched && name.trim() !== '' && <span className={styles.amber}>{words.unsaved}</span>}
        <span className={styles.spacer} />
        {!isNew && (
          <Button variant="danger" onClick={() => setAsking(true)}>
            {words.deleteAction}
          </Button>
        )}
        <Button variant="primary" loading={save.isPending} disabled={!body || untouched || hasRefused} onClick={send}>
          {words.save}
        </Button>
      </div>
      <p className={styles.noteRow}>{words.firstMatchWins}</p>
      {refusal && (
        <Banner tone="danger">
          {refusal.message}
          {refusal.policies && refusal.policies.length > 0 && <p>{refusal.policies.join(' · ')}</p>}
        </Banner>
      )}
      <div className={styles.rules}>
        <div className={styles.ruleHead}>
          <span>{words.colIf}</span>
          <span>{words.colSend}</span>
          <span>{words.colNote}</span>
        </div>
        <div className={styles.ruleLocked}>
          <span className={styles.lockCell}>
            <Icon name="lock" size="sm" />
            {words.hygieneMatch}
          </span>
          <span>{words.hygieneAction}</span>
          <span className={styles.note}>{words.hygieneNote}</span>
        </div>
        {rules.length === 0 && <p className={styles.ruleQuiet}>{words.noRules}</p>}
        {rules.map((rule, i) => {
          const note = shadowNote(rule)
          const extras = extraMatchers(rule.match)
          const refused = refusedIn(rule)
          return (
            <div key={rule.id} className={note ? styles.ruleShadowed : styles.rule} onDragOver={(e) => e.preventDefault()} onDrop={() => dragged !== null && move(dragged, i)}>
              <div className={styles.matchWithGrip}>
                <span className={styles.grip} draggable onDragStart={() => setDragged(i)} onDragEnd={() => setDragged(null)} aria-hidden>
                  <Icon name="grip" size="sm" />
                </span>
                <MatchInput label={words.matchField} placeholder={words.nodeMatchHolder} value={matchTokens(rule.match).join(' · ')} bad={refused.length > 0} shadowed={note !== null} onChange={(line) => setRule(i, { ...rule, match: parseTokens(line, rule.match, kinds) })} />
              </div>
              <Select aria-label={words.actionField} value={actionValue(rule)} onChange={(e) => setRule(i, { ...rule, action: actionOf(e.target.value) })} options={actionOptions(rule)} />
              <div className={styles.ruleNote}>
                {note && <span className={styles.amber}>{note}</span>}
                {!note && extras.length > 0 && <span className={styles.note}>{extras.join(' · ')}</span>}
                {refused.length > 0 && <span className={styles.danger}>{words.tokenRefused(refused.join(', '))}</span>}
              </div>
              <div className={styles.actions}>
                <Button size="sm" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  {words.moveUp}
                </Button>
                <Button size="sm" disabled={i === rules.length - 1} onClick={() => move(i, i + 1)}>
                  {words.moveDown}
                </Button>
                <Button size="sm" onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}>
                  {words.remove}
                </Button>
              </div>
            </div>
          )
        })}
        <div className={styles.ruleAdd}>
          <Button
            size="sm"
            icon={<Icon name="plus" size="sm" />}
            onClick={() => {
              nextKey.current += 1
              setRules((prev) => [...prev, { id: `new-${nextKey.current}`, position: prev.length, enabled: true, match: { domain: [], ip: [], port: null, protocol: [], network: null }, action: { kind: 'block', directionId: null }, shadowedBy: null }])
            }}
          >
            {words.addRule}
          </Button>
          {directions.length === 0 && <p className={styles.note}>{words.noDirections}</p>}
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
          <p>{count.deleteBody}</p>
        </Confirm>
      )}
    </section>
  )
}
