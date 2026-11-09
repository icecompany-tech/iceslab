import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { NodeRoutes } from '@/contours/nodes/components/NodeRoutes'
import { CoreVersions } from '@/contours/nodes/components/CoreVersions'
import { CoresStep, EgressStep, HostsBlock, PolicyStep, ServiceStep } from '@/contours/nodes/components/NodeSteps'
import { coreVersionRefusal } from '@/lib/old/coreVersions'
import { SystemStrip } from '@/contours/nodes/components/SystemStrip'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCascades, useDeleteNode, useNode, useNodeHosts, useRegions, useSyncStatus, useUpdateNode } from '@/contours/nodes/hooks/useNodes'
import { squadsLosingLastHost, useSquads } from '@/lib/domain/squads'
import { draftErrors, draftOfNode, hostChanged, nodeUpdateBody, type NodeDraft } from '@/contours/nodes/lib/nodeBody'
import { nodeDeleteFacts } from '@/contours/nodes/lib/nodeDelete'
import { nodeHealth } from '@/lib/domain/overview'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeMemberships } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { Step } from '@/ui/Step/Step'
import { useToast } from '@/ui/Toast/useToast'

const UNINSTALL = 'bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) --uninstall'

type Tab = 'settings' | 'routes'
type StepId = 'cores' | 'egress' | 'policy' | 'limits' | 'service'

function NodeForm({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const update = useUpdateNode(node.id)
  const remove = useDeleteNode()
  const regions = useRegions()
  const cascades = useCascades()
  const health = nodeHealth(node.status)
  const sync = useSyncStatus(node.id, true)
  const [initial, setInitial] = useState<NodeDraft>(() => draftOfNode(node))
  const [draft, setDraft] = useState<NodeDraft>(initial)
  const [tab, setTab] = useState<Tab>('settings')
  const [open, setOpen] = useState<StepId | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [versionsRefused, setVersionsRefused] = useState<string[] | null>(null)
  const [asking, setAsking] = useState(false)
  const patch = (next: Partial<NodeDraft>) => setDraft((d) => ({ ...d, ...next }))
  const toggle = (step: StepId) => setOpen(open === step ? null : step)
  const body = nodeUpdateBody(initial, draft, node)
  const errors = draftErrors(draft)
  const changed = Object.keys(body).length > 0
  const member = cascadeMemberships(cascades.data?.cascades ?? []).get(node.id)
  const blocked = nodeDeleteFacts(node)?.blocked ?? (member ? [member.cascade.name] : [])
  const nodeHosts = useNodeHosts(node.id)
  const squads = useSquads()
  const lastOf = squadsLosingLastHost((nodeHosts.data?.hosts ?? []).map((h) => h.id), squads.data ?? [])
  const notApplied = sync.data && !sync.data.applied && sync.data.online
  const coreError = node.lastInboundSyncError

  const save = () => {
    setRefusal(null)
    setVersionsRefused(null)
    update.mutate(body, {
      onSuccess: () => {
        setInitial(draft)
        toast.show(words.saved)
      },
      onError: (err) => {
        const lines = coreVersionRefusal(err)
        if (lines) {
          setVersionsRefused(lines)
          setOpen('cores')
        } else setRefusal(failureText(err, locale))
      },
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{node.name}</h1>
        <Segmented<Tab> label={words.tabLabel} value={tab} onChange={setTab} options={[{ value: 'settings', label: words.tabs.settings }, { value: 'routes', label: words.tabs.routes }]} />
      </div>
      {tab === 'routes' ? (
        <NodeRoutes node={node} />
      ) : (
        <>
          <SystemStrip node={node} />
          {health === 'problem' && <Banner tone="danger" title={words.statusWord[node.status] ?? node.status}>{node.lastStatusMessage ? words.unreachableBody(node.lastStatusMessage) : words.unreachableNoMessage}</Banner>}
          {health === 'problem' && <p className={styles.note}>{words.linkDownBody}</p>}
          {health === 'unverified' && <Banner title={words.unverifiedTitle}>{words.unverifiedBody}</Banner>}
          {health === 'ok' && coreError && (
            <Banner tone="danger" title={words.coreRefusedTitle}>
              {words.coreRefusedBody}
              <pre className={styles.coreAnswer}>{coreError.message}</pre>
            </Banner>
          )}
          {notApplied && !coreError && <Banner title={words.notApplied}>{words.notAppliedBody}</Banner>}
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.basics}</h2>
            <div className={styles.formRow}>
              <Field label={words.name} error={errors.name ? words.nameRequired : undefined}>{(a11y) => <Input {...a11y} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
              <Field label={words.host} error={errors.host ? words.hostRequired : undefined}>{(a11y) => <Input {...a11y} value={draft.host} onChange={(e) => patch({ host: e.target.value })} />}</Field>
              <Field label={words.port} error={errors.port ? words.portBad : undefined}>{(a11y) => <Input {...a11y} inputMode="numeric" value={draft.port} onChange={(e) => patch({ port: e.target.value })} />}</Field>
              <Field label={words.country}>{(a11y) => <Input {...a11y} maxLength={2} value={draft.countryCode} onChange={(e) => patch({ countryCode: e.target.value.toUpperCase() })} />}</Field>
            </div>
            {hostChanged(initial, draft) && <Banner title={words.addressChange}>{words.addressChangeBody}</Banner>}
          </section>
          <Step title={words.coresTitle} open={open === 'cores'} onToggle={() => toggle('cores')} value={(node.engines ?? node.intendedEngines ?? []).join(', ') || '-'}>
            <CoresStep node={node} />
            {node.coreVersions !== undefined && <CoreVersions engines={node.engines ?? node.intendedEngines ?? []} value={draft.coreVersions} onChange={(coreVersions) => patch({ coreVersions })} refusal={versionsRefused} />}
          </Step>
          <EgressStep node={node} open={open === 'egress'} onToggle={() => toggle('egress')} memberName={member?.cascade.name ?? null} cascadesKnown={cascades.data !== undefined} />
          <PolicyStep node={node} value={draft.policyId} onChange={(policyId) => patch({ policyId })} open={open === 'policy'} onToggle={() => toggle('policy')} />
          <Step optional title={words.limits} open={open === 'limits'} onToggle={() => toggle('limits')} value={draft.domain || '-'}>
            <div className={styles.formRow}>
              <Field label={words.domain} error={errors.domain ? words.domainBad : undefined} hint={words.domainHint}>{(a11y) => <Input {...a11y} value={draft.domain} onChange={(e) => patch({ domain: e.target.value })} />}</Field>
              <Field label={words.region} hint={words.regionHint}>{(a11y) => <Select {...a11y} value={draft.regionId} onChange={(e) => patch({ regionId: e.target.value })} options={[{ value: '', label: words.regionNone }, ...(regions.data?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))]} />}</Field>
              <Field label={words.multiplier} error={errors.multiplier ? words.multiplierBad : undefined} hint={words.multiplierHint}>{(a11y) => <Input {...a11y} inputMode="decimal" value={draft.multiplier} onChange={(e) => patch({ multiplier: e.target.value })} />}</Field>
              <Field label={words.maxUsers} error={errors.maxUsers ? words.maxUsersBad : undefined} hint={words.maxUsersHint}>{(a11y) => <Input {...a11y} inputMode="numeric" value={draft.maxUsers} onChange={(e) => patch({ maxUsers: e.target.value })} />}</Field>
            </div>
          </Step>
          <Step optional title={words.service} open={open === 'service'} onToggle={() => toggle('service')}>
            <ServiceStep node={node} />
          </Step>
          <HostsBlock node={node} />
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.deleteTitle}</h2>
            {blocked.length > 0 ? (
              <Banner title={words.deleteRun} action={member ? <Link className={styles.linkPlain} to={`/cascades/${member.cascade.id}`}>{words.openCascade}</Link> : undefined}>
                {words.deleteLocked(blocked.join(', '))}
              </Banner>
            ) : lastOf.length > 0 ? (
              <Banner title={words.deleteRun}>{words.deleteLastHost(lastOf.join(', '))}</Banner>
            ) : (
              <div>
                <Button variant="danger" onClick={() => setAsking(true)}>
                  {words.deleteRun}
                </Button>
              </div>
            )}
          </section>
          {refusal && <Banner tone="danger" title={words.policyRefused}>{refusal}</Banner>}
          <div className={styles.actions}>
            <Button onClick={() => setDraft(initial)} disabled={!changed}>
              {words.cancel}
            </Button>
            <Button variant="primary" disabled={!changed || Object.keys(errors).length > 0} loading={update.isPending} onClick={save}>
              {words.save}
            </Button>
          </div>
        </>
      )}
      {asking && (
        <Confirm
          title={words.deleteConfirmTitle(node.name)}
          labels={{ confirm: words.deleteRun, cancel: words.cancel }}
          state={{ busy: remove.isPending, error: remove.error ? failureText(remove.error, locale) : null }}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            remove.mutate(node.id, {
              onSuccess: () => {
                toast.show(words.deleted(node.name))
                void navigate('/nodes')
              },
            })
          }
        >
          {words.deleteConfirmBody}
          <Command text={UNINSTALL} copyLabel={words.copy} copiedLabel={words.copied} />
        </Confirm>
      )}
    </div>
  )
}

export default function NodeEditPage() {
  const { id = '' } = useParams()
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const node = useNode(id)
  if (node.isPending) return <QueryLoading label={words.loading} />
  if (node.isError) return <QueryFailed title={words.failedTitle} body={failureText(node.error, locale)} retryLabel={words.retry} onRetry={() => void node.refetch()} />
  if (!node.data) return <QueryFailed title={words.goneTitle} body={words.goneBody} retryLabel={words.backToList} onRetry={() => void navigate('/nodes')} />
  return <NodeForm key={node.data.id} node={node.data} />
}
