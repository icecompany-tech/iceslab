import { PoolField } from '@/contours/cascades/components/PoolField'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { chainEntryList, entryChainFacts, entryChainGaps, entryChainNotes, entryNoteKind, entryPolicyPlace, entryProtocolDefault, protocolOptions } from '@/contours/cascades/lib/cascadeForm'
import { useDict } from '@/lib/i18n'
import type { CascadeProtocol } from '@/lib/old/cascades'
import { chainFacts } from '@/lib/old/chainStatus'
import { isOlderThan, MIN_CASCADE_CORE } from '@/lib/old/protocols'
import { Flag } from '@/ui/Flag/Flag'
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

function EntryNodes({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const chosen = form.entryIds
  const used = new Set(form.othersThan(chosen))
  const sorted = [...form.nodes].sort((a,b) => {
    const rank = (id: string) => chosen.includes(id) ? 0 : form.claimedBy.has(id) || used.has(id) ? 2 : 1
    return rank(a.id) - rank(b.id)
  })
  const render = (node: (typeof form.nodes)[number]) => {
    const owner = form.claimedBy.get(node.id)
    const engines = node.cores?.cores.filter(core => core.installed !== false).map(core => [core.engine ?? core.name, core.version].filter(Boolean).join(' '))
    const inventory = engines?.join(', ') || (node.engines?.length ? node.engines.join(', ') : node.cores ? words.agentOnly : words.coreUnknown)
    return <label className={styles.entryChoice} key={node.id}>
      <input type="checkbox" aria-label={node.name} checked={chosen.includes(node.id)} disabled={used.has(node.id)}
        onChange={e => form.setPoolNodes(0, e.target.checked ? [...chosen,node.id] : chosen.filter(id => id !== node.id))} />
      <Flag code={node.countryCode} /><strong>{node.name}</strong>
      <span>{owner ? words.nodeInCascade(owner) : inventory}</span>
    </label>
  }
  const limit = Math.max(6, chosen.length)
  return <div className={styles.entryChoices}>
    <p className={styles.note}>{words.entryHint}</p>
    <div className={styles.entryList}>{sorted.slice(0,limit).map(render)}</div>
    {sorted.length > limit && <details><summary>{words.moreNodes} ({sorted.length-limit})</summary>{sorted.slice(limit).map(render)}</details>}
  </div>
}

function EntryProtocols({ form, value }: { form: CascadeForm; value: CascadeProtocol }) {
  const words = useDict(DICT)
  const options = protocolOptions(value)
  const descriptions: Record<string, string> = { xray: words.entryXray, hysteria: words.entryHy2, amneziawg: words.entryAwg }
  const primary = options.filter(option => descriptions[option.value])
  const others = options.filter(option => !descriptions[option.value])
  const render = (option: (typeof options)[number]) => (
    <label key={option.value} className={styles.protocolChoice}>
      <input type="radio" name="entry-protocol" value={option.value} checked={value === option.value}
        onChange={() => form.setPool(0, { entryProtocol: option.value as CascadeProtocol })} />
      <span><strong>{option.value === 'hysteria' ? 'Hysteria 2' : option.value === 'amneziawg' ? 'AmneziaWG' : option.label}</strong>
        {descriptions[option.value] && <small>{descriptions[option.value]}</small>}
      </span>
    </label>
  )
  return (
    <fieldset className={styles.protocols}>
      <legend>{words.howClientConnects}</legend>
      {primary.map(render)}
      {others.length > 0 && <details open={others.some(option => option.value === value) || undefined}><summary>{words.otherProtocols}</summary>{others.map(render)}</details>}
    </fieldset>
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
      {form.cascade === null && form.entryIds.every(id => form.nodeById.has(id)) ? <EntryNodes form={form} /> : <PoolField form={form} label={words.poolEntry} ids={pool.nodeIds} onChange={(ids) => form.setPoolNodes(0, ids)} />}
      {form.cascade === null ? <EntryProtocols form={form} value={pool.entryProtocol} /> : <Field label={words.entryProtocol}>{(a11y) => <Select {...a11y} value={pool.entryProtocol} onChange={(e) => form.setPool(0, { entryProtocol: e.target.value as CascadeProtocol })} options={protocolOptions(pool.entryProtocol)} />}</Field>}
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
      {place === 'xray-self' && form.cascade !== null && <p className={styles.note}>{words.entryPolicyXray}</p>}
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
