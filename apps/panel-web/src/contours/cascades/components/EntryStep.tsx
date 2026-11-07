import { PoolField } from '@/contours/cascades/components/PoolField'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { chainEntryList, entryChainFacts, entryChainGaps, entryChainNotes, entryNoteKind, entryPolicyPlace, entryProtocolDefault, protocolOptions } from '@/contours/cascades/lib/cascadeForm'
import { useDict } from '@/lib/i18n'
import type { CascadeProtocol } from '@/lib/old/cascades'
import { chainFacts } from '@/lib/old/chainStatus'
import { isOlderThan, MIN_CASCADE_CORE } from '@/lib/old/protocols'
import { Field } from '@/ui/Field/Field'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'

export function ChainNotes({ form, ids }: { form: CascadeForm; ids: readonly string[] }) {
  const words = useDict(DICT)
  return (
    <>
      {ids.map((id) => {
        const node = form.nodeById.get(id)
        const facts = chainFacts(node)
        if (!node || !facts || facts.state === 'up') return null
        switch (facts.state) {
          case 'down':
            return (
              <p key={id} className={styles.danger}>
                {facts.error ? words.chainDown(node.name, facts.error) : words.chainDownBare(node.name)}
              </p>
            )
          case 'unknown':
          case 'stale':
            return (
              <p key={id} className={styles.note}>
                {words.chainNoData(node.name)}
              </p>
            )
        }
      })}
    </>
  )
}

export function EntryStep({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const pool = form.draft.pools[0]
  if (!pool) return null
  const facts = entryChainFacts(pool.entryProtocol)
  const kind = entryNoteKind(facts)
  const head = form.nodeById.get(form.entryIds[0] ?? '')
  const noCore = head ? entryProtocolDefault(head).kind === 'none' : false
  const place = entryPolicyPlace(pool.entryProtocol, form.draft.entryPolicyId !== undefined)
  const refused = form.refusal?.kind === 'entryChain' ? form.refusal.conflicts : []
  const notes = entryChainNotes(entryChainGaps(form.entryIds.map((id) => form.nodeById.get(id))), refused)
  const stale = form.draft.directions.length > 1 ? form.entryIds.flatMap((id) => {
    const n = form.nodeById.get(id)
    return n && isOlderThan(n.coreVersion, MIN_CASCADE_CORE) ? [n] : []
  }) : []
  return (
    <>
      <PoolField form={form} label={words.poolEntry} ids={pool.nodeIds} onChange={(ids) => form.setPoolNodes(0, ids)} />
      <Field label={words.entryProtocol}>{(a11y) => <Select {...a11y} value={pool.entryProtocol} onChange={(e) => form.setPool(0, { entryProtocol: e.target.value as CascadeProtocol })} options={protocolOptions(pool.entryProtocol)} />}</Field>
      {kind === 'notCarried' && facts && <p className={styles.danger}>{words.entryNotCarried(facts.protocol, chainEntryList())}</p>}
      {kind === 'autoOnly' && facts && <p className={styles.note}>{words.entryAutoOnly(facts.protocol)}</p>}
      {noCore && <p className={styles.danger}>{words.entryNoCore(chainEntryList())}</p>}
      {place === 'select' && (
        <>
          {form.policies.isError ? (
            <QueryFailedLine retryLabel={words.retry} onRetry={() => void form.policies.refetch()}>
              {words.entryPolicyFailed}
            </QueryFailedLine>
          ) : (
            <Field label={words.entryPolicy} hint={words.entryPolicyHint} error={form.refusal?.kind === 'policyGone' ? words.entryPolicyGone : undefined}>
              {(a11y) => <Select {...a11y} value={form.draft.entryPolicyId ?? ''} onChange={(e) => form.patch({ entryPolicyId: e.target.value || null })} options={[{ value: '', label: words.entryPolicyNone }, ...(form.policies.data?.policies ?? []).map((p) => ({ value: p.id, label: p.name }))]} />}
            </Field>
          )}
        </>
      )}
      {place === 'xray-self' && <p className={styles.note}>{words.entryPolicyXray}</p>}
      {form.entry.failed && <p className={styles.note}>{words.entryListsFailed}</p>}
      {form.entry.bystanders?.map((b) => (
        <p key={b.nodeId} className={styles.note}>
          {words.entryBystanders(b.protocols.join(', '), b.nodeName, b.countryCode ?? words.entryCountryUnknown)}
        </p>
      ))}
      {notes.map((c) => (
        <p key={c.nodeName} className={styles.danger}>
          {words.entryCannotChain(c.nodeName, c.engines.length > 0 ? c.engines.join(', ') : words.legNodeNoEngines)}
        </p>
      ))}
      {stale.map((n) => (
        <p key={n.id} className={styles.amber}>
          {words.entryCoreOld(n.name, n.coreVersion ?? '', MIN_CASCADE_CORE)}
        </p>
      ))}
      <ChainNotes form={form} ids={form.entryIds} />
    </>
  )
}
