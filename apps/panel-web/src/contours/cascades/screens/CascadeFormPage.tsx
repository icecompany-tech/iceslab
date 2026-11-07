import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DeleteWindow, EntryAskWindow } from '@/contours/cascades/components/CascadeWindows'
import { EntryStep } from '@/contours/cascades/components/EntryStep'
import { ExitStep } from '@/contours/cascades/components/ExitStep'
import { LinkStep } from '@/contours/cascades/components/LinkStep'
import { PushPanel, SubscribersPanel, TunnelsPanel } from '@/contours/cascades/components/SidePanels'
import { TransitStep } from '@/contours/cascades/components/TransitStep'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import { useCascadeForm, type CascadeForm, type StepId } from '@/contours/cascades/hooks/useCascadeForm'
import { useCascadeStatus, useCascadesList, useFleet } from '@/contours/cascades/hooks/useCascades'
import { MAX_LINKS, MAX_POSITIONS, directionEmpty, chainEntryList } from '@/contours/cascades/lib/cascadeForm'
import type { Blocker } from '@/contours/cascades/lib/draft'
import { buildFlow } from '@/contours/cascades/lib/flow'
import { refusalCount } from '@/contours/cascades/lib/refusal'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeStatusView } from '@/lib/old/cascadeStatus'
import type { Cascade } from '@/lib/old/cascades'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { CascadeFlow } from '@/ui/CascadeFlow/CascadeFlow'
import { Field, Input } from '@/ui/Field/Field'
import { HopMeter } from '@/ui/HopMeter/HopMeter'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Step } from '@/ui/Step/Step'
import { Switch } from '@/ui/Switch/Switch'

function blockerWords(blocker: Blocker, words: typeof DICT.ru): string {
  switch (blocker.kind) {
    case 'name':
      return words.blockerName
    case 'distinct':
      return words.blockerDistinct
    case 'entry':
      return words.blockerEntry
    case 'transit':
      return words.blockerTransit
    case 'direction':
      return words.blockerDirection
    case 'links':
      return words.tooManyLinks(blocker.links, MAX_LINKS)
    case 'legacy':
      return words.blockerLegacy(blocker.node, blocker.values.join(', '))
    case 'notCarried':
      return words.entryNotCarried(blocker.protocol, chainEntryList())
  }
}

function RefusalTop({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { refusal, failure } = form
  if (failure) return <Banner tone="danger">{failure}</Banner>
  if (!refusal) return null
  switch (refusal.kind) {
    case 'otherCascade':
      return (
        <Banner
          tone="danger"
          action={
            refusal.taken.cascadeId ? (
              <Link className={styles.link} to={`/cascades/${refusal.taken.cascadeId}`}>
                {words.otherCascadeOpen}
              </Link>
            ) : undefined
          }
        >
          {words.otherCascade(refusal.taken.nodeName, refusal.taken.cascadeName)}
        </Banner>
      )
    case 'moved':
      return <Banner tone="danger">{words.positionMoved(refusal.position, refusal.stored)}</Banner>
    case 'shape':
      return <Banner tone="danger">{refusal.message}</Banner>
    case 'cells':
    case 'direction':
    case 'entryChain':
    case 'entryChange':
    case 'entryNodes':
    case 'policyGone':
    case 'ports':
    case 'tags':
    case 'underlay':
      return <Banner tone="danger">{words.refusalTop(refusalCount(refusal))}</Banner>
  }
}

function Steps({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { draft, refusal } = form
  const step = (id: StepId) => ({ open: form.open === id, onToggle: () => form.toggleStep(id) })
  const refusedAt = (kinds: readonly string[]) => (refusal && kinds.includes(refusal.kind) ? <span className={styles.danger}>{words.refusalTop(refusalCount(refusal))}</span> : null)
  const entryNames = form.entryIds.map(form.nodeName).join(', ') || words.pendingEntry
  const countries = draft.directions.map((d) => d.countryCode).filter(Boolean).join(', ') || words.directionNoNodes
  const legs = draft.pools.length + draft.directions.filter((d) => !directionEmpty(d)).length - 1
  const served = draft.directions.filter((d) => !directionEmpty(d)).length
  const exitNames = draft.directions.flatMap((d) => d.nodeIds).filter(Boolean).map(form.nodeName).join(', ')
  return (
    <>
      <Step title={words.stepEntry} value={refusedAt(['entryChain', 'policyGone']) ?? `${entryNames} · ${draft.pools[0]?.entryProtocol ?? ''}`} {...step('entry')}>
        <EntryStep form={form} />
      </Step>
      <Step optional title={words.stepTransit} value={draft.pools.length > 1 ? words.summaryHops(draft.pools.length - 1) : words.summaryNone} {...step('transit')}>
        <TransitStep form={form} />
      </Step>
      <Step title={words.stepExit} value={refusedAt(['direction', 'tags']) ?? countries} {...step('exit')}>
        <ExitStep form={form} />
      </Step>
      <Step optional title={words.stepLink} value={refusedAt(['cells', 'ports', 'underlay']) ?? words.summaryLegs(Math.max(legs, 0))} {...step('link')}>
        <LinkStep form={form} />
      </Step>
      <Step optional title={words.stepSubscription} value={draft.autoProfile ? words.summaryOn : words.summaryOff} {...step('subscription')}>
        <div className={styles.switches}>
          <Switch label={words.hideHops} checked={draft.hideHops} onChange={(hideHops) => form.patch({ hideHops })} />
          <p className={styles.note}>{exitNames ? words.hideHopsNamed(exitNames) : words.hideHopsHint}</p>
          <Switch label={words.autoProfile} checked={draft.autoProfile} disabled={served < 2} onChange={(autoProfile) => form.patch({ autoProfile })} />
          <p className={styles.note}>{served < 2 ? words.autoNeedsTwo : words.autoProfileHint}</p>
        </div>
      </Step>
    </>
  )
}

function Form({ cascade, cascades, fields, nodes }: Parameters<typeof useCascadeForm>[0]) {
  const words = useDict(DICT)
  const navigate = useNavigate()
  const form = useCascadeForm({ cascade, cascades, fields, nodes })
  const [deleting, setDeleting] = useState(false)
  const { draft } = form
  const status = useCascadeStatus(cascade?.id ?? '', cascade !== null && cascade.enabled)
  const push = cascadeStatusView(status.data)
  const flow = buildFlow({ pools: draft.pools, directions: draft.directions, enabled: draft.enabled, autoProfile: draft.autoProfile, nodeById: form.nodeById, outboundById: form.outbounds.data ? new Map(form.outbounds.data.outbounds.map((o) => [o.id, o])) : null, ...(status.data ? { hops: status.data.hops } : {}) }, words)
  const hops = draft.pools.length + 1
  const saveWord = cascade === null ? words.saveNew : draft.enabled ? words.saveLive : words.saveOff
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Link className={styles.link} to="/cascades">
            {words.crumbs}
          </Link>
          <h1 className={styles.pageTitle}>{cascade?.name ?? words.newTitle}</h1>
          <HopMeter count={hops} max={MAX_POSITIONS} label={words.hopMeter(hops, MAX_POSITIONS)} />
        </div>
        <div className={styles.actions}>
          {!form.untouched && cascade !== null && <span className={styles.amber}>{words.unsaved}</span>}
          {cascade !== null && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {words.deleteAction}
            </Button>
          )}
          <Button onClick={() => void navigate('/cascades')}>{words.cancel}</Button>
          <Button variant="primary" loading={form.saving} disabled={form.blocker !== null || form.untouched} onClick={form.save}>
            {saveWord}
          </Button>
        </div>
      </div>
      {form.blocker && !form.untouched && <p className={styles.amber}>{blockerWords(form.blocker, words)}</p>}
      <RefusalTop form={form} />
      {push.kind === 'broken' && <Banner tone="danger" title={words.brokenBanner}>{push.broken}</Banner>}
      {cascade !== null && !draft.enabled && <Banner tone="info">{words.offNote}</Banner>}
      <section className={styles.panel}>
        <CascadeFlow label={words.flowLabel(draft.name)} columns={flow.columns} links={flow.links} {...(flow.legend ? { legend: flow.legend } : {})} />
      </section>
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <Field label={words.name} hint={words.nameHint}>{(a11y) => <Input {...a11y} autoFocus={cascade === null} value={draft.name} onChange={(e) => form.patch({ name: e.target.value })} />}</Field>
            <Switch label={words.stateLabel} checked={draft.enabled} onChange={(enabled) => form.patch({ enabled })} />
            <p className={styles.note}>{words.stateHint}</p>
          </section>
          <Steps form={form} />
        </div>
        <div className={styles.right}>
          <SubscribersPanel form={form} />
          {cascade !== null && <PushPanel form={form} cascade={cascade} />}
          {cascade !== null && <TunnelsPanel form={form} cascade={cascade} />}
        </div>
      </div>
      <EntryAskWindow form={form} />
      {deleting && cascade !== null && <DeleteWindow cascade={cascade} onClose={() => setDeleting(false)} onDeleted={() => void navigate('/cascades')} />}
    </div>
  )
}

export default function CascadeFormPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const { id } = useParams()
  const cascades = useCascadesList()
  const fleet = useFleet()
  if (cascades.isError) return <QueryFailed title={words.failedTitle} body={failureText(cascades.error, locale)} retryLabel={words.retry} onRetry={() => void cascades.refetch()} />
  if (fleet.isError) return <QueryFailed title={words.nodesFailedTitle} body={failureText(fleet.error, locale)} retryLabel={words.retry} onRetry={() => void fleet.refetch()} />
  if (!cascades.data || !fleet.data) return <QueryLoading label={words.loading} />
  const list: readonly Cascade[] = cascades.data.cascades
  const cascade = id ? (list.find((c) => c.id === id) ?? null) : null
  if (id && !cascade) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{words.gone}</h2>
        <p>{words.goneBody}</p>
        <Link className={styles.link} to="/cascades">
          {words.backToList}
        </Link>
      </div>
    )
  }
  return <Form key={id ?? 'new'} cascade={cascade} cascades={list} fields={cascades.data.fields} nodes={fleet.data.nodes} />
}
