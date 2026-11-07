import { useMemo, useState } from 'react'
import { RuleWindow } from '@/contours/subscription/components/RuleWindow'
import styles from '@/contours/subscription/components/subscription.module.css'
import { DICT } from '@/contours/subscription/dict'
import { useDeleteRule, useRules, useToggleRule } from '@/contours/subscription/hooks/useSubscription'
import { fallsTo } from '@/contours/subscription/lib/srrBody'
import { SRR_FORMATS } from '@/contours/subscription/lib/srrFormats'
import { isCatchAll, matchingRules } from '@/contours/subscription/lib/srrMatch'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { SrrRule } from '@/lib/old/srr'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

type Editing = { rule: SrrRule | null } | null

export default function DeliveryPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const query = useRules()
  const toggle = useToggleRule()
  const remove = useDeleteRule()
  const rules = useMemo(() => [...(query.data?.rules ?? [])].sort((a, b) => a.priority - b.priority), [query.data])
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<SrrRule | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [ua, setUa] = useState('')
  const [tested, setTested] = useState<string | null>(null)
  const hits = tested ? matchingRules(rules, tested) : []
  const winner = hits[0] ?? null
  const name = (f: string) => words.formatNames[f] ?? f

  const flip = (rule: SrrRule, enabled: boolean) =>
    toggle.mutate({ id: rule.id, enabled }, { onError: (err) => toast.show(`${words.toggleFailed}: ${failureText(err, locale)}`, 'failed') })
  const confirmDelete = () => {
    if (!deleting) return
    setDeleteError(null)
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null)
        toast.show(words.ruleDeleted)
      },
      onError: (err) => setDeleteError(failureText(err, locale)),
    })
  }
  const deleteWords = (rule: SrrRule) => {
    const to = fallsTo(rules, rule)
    switch (to.kind) {
      case 'catchAll':
        return words.deleteRuleCatchAll(to.name, name(to.format))
      case 'endpointDefault':
        return words.deleteRuleDefault
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h1 className={styles.pageTitle}>{words.deliveryTitle}</h1>
          <p className={styles.note}>{words.deliverySubtitle}</p>
        </div>
        <Button variant="primary" icon={<Icon name="plus" size="md" />} onClick={() => setEditing({ rule: null })}>
          {words.create}
        </Button>
      </div>
      {query.isPending && <QueryLoading label={words.loading} />}
          {query.isError && <QueryFailed title={words.rulesFailed} body={failureText(query.error, locale)} retryLabel={words.retry} onRetry={() => void query.refetch()} />}
          {query.data && rules.length === 0 && (
            <div className={styles.empty}>
              <h2 className={styles.emptyTitle}>{words.rulesEmpty}</h2>
              <p>{words.rulesEmptyBody}</p>
            </div>
          )}
          {rules.length > 0 && (
            <div className={styles.tableBox}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{words.colPriority}</th>
                    <th scope="col">{words.colName}</th>
                    <th scope="col">{words.colPattern}</th>
                    <th scope="col">{words.colFormat}</th>
                    <th scope="col">{words.colTemplate}</th>
                    <th scope="col">{words.colEnabled}</th>
                    <th scope="col">{words.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, i) => {
                    const twin = rules[i - 1]?.priority === rule.priority ? rules[i - 1] : undefined
                    return (
                      <tr key={rule.id} className={winner?.id === rule.id ? styles.rowWinner : undefined}>
                        <td>
                          {rule.priority}
                          {twin && <p className={styles.amber}>{words.samePriority(twin.name)}</p>}
                        </td>
                        <td>
                          {rule.name}
                          {isCatchAll(rule.uaPattern) && <p className={styles.note}>{words.catchAll}</p>}
                        </td>
                        <td className={styles.mono}>{rule.uaPattern}</td>
                        <td>{name(rule.format)}</td>
                        <td>{rule.templateName ?? 'Default'}</td>
                        <td>
                          <Switch labelHidden label={words.enabledLabel(rule.name)} checked={rule.enabled} onChange={(on) => flip(rule, on)} />
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <Button size="sm" onClick={() => setEditing({ rule })}>
                              {words.edit}
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setDeleting(rule)}>
                              {words.deleteAction}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.testTitle}</h2>
            <p className={styles.note}>{words.testHint}</p>
            <Field label={words.testField}>{(a11y) => <Input {...a11y} placeholder="Happ/1.42.0 (iPhone; iOS 18.2)" value={ua} onChange={(e) => setUa(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setTested(ua.trim() || null)} />}</Field>
            <div>
              <Button size="sm" disabled={ua.trim() === ''} onClick={() => setTested(ua.trim() || null)}>
                {words.testButton}
              </Button>
            </div>
            {tested === null && <p className={styles.note}>{words.testNone}</p>}
            {tested !== null && winner && <p className={styles.ok}>{words.testMatch(winner.priority, winner.name, name(winner.format))}</p>}
            {tested !== null && hits.length > 1 && <p className={styles.note}>{words.testShadowed(hits.length - 1)}</p>}
            {tested !== null && !winner && <p className={styles.amber}>{words.testNoMatch}</p>}
          </section>
        </div>
        <div className={styles.right}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.howTitle}</h2>
            <p className={styles.note}>{words.how1}</p>
            <p className={styles.note}>{words.how2}</p>
            <p className={styles.amber}>{words.how3}</p>
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.formatsTitle}</h2>
            <ul className={styles.plainList}>
              {SRR_FORMATS.filter((f) => words.formatAbout[f] !== undefined).map((f) => (
                <li key={f} className={styles.formatRow}>
                  <span>{name(f)}</span>
                  <span className={styles.note}>{words.formatAbout[f]}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {editing && <RuleWindow rule={editing.rule} rules={rules} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm title={words.deleteRuleTitle(deleting.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
          <p>{deleteWords(deleting)}</p>
        </Confirm>
      )}
    </div>
  )
}
