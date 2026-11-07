import { coreRemoveCommand, type ConnLogTraceResponse } from '@iceslab/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useClearConnLog, useConnLog, useExposure, useNodeBindings, useNodeConnectTest, useNodeHosts, useNodePolicies, useReissueBootstrap, useRotateCert, useRotateHysteriaTls, useWarp } from '@/contours/nodes/hooks/useNodes'
import { connLogView } from '@/contours/nodes/lib/connLogView'
import { coreEngine, coreRemoveFacts, coreRowsInManifestOrder, firstRowOfEngine } from '@/contours/nodes/lib/coreRemove'
import { exposureView } from '@/contours/nodes/lib/exposureView'
import { canRotateHysteriaTls, isNativeHysteria } from '@/contours/nodes/lib/hysteriaTls'
import { certPageView, certRotateRefusal, certTerm } from '@/contours/nodes/lib/nodeCert'
import { egressOf } from '@/contours/nodes/lib/nodeEditForm'
import { isPayloadOnly } from '@/contours/nodes/lib/payloadInstall'
import { policyCoverage } from '@/contours/nodes/lib/policyReach'
import { useNow } from '@/lib/clock'
import { engineLabel } from '@/lib/domain/engines'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { coreNeed, coreVersionFacts, type CoreVersionLine } from '@/lib/old/coreVersions'
import type { BootstrapInfo, Node, NodeCore } from '@/lib/old/nodes'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'
import { Step } from '@/ui/Step/Step'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

function CoreRow({ core, node, showRemove }: { core: NodeCore; node: Node; showRemove: boolean }) {
  const words = useDict(DICT)
  const [shown, setShown] = useState<'update' | 'remove' | null>(null)
  const engine = coreEngine(core)
  const need = coreNeed(core)
  const lines: CoreVersionLine[] = coreVersionFacts(core, node.cores?.arch, node.coreVersions ?? {})
  const moved = lines.find((l) => l.command !== null)
  const remove = engine ? coreRemoveFacts(engine, node) : null
  const copy = { copyLabel: words.copy, copiedLabel: words.copied }
  return (
    <li className={styles.coreRow}>
      <div className={styles.coreHead}>
        <b>{engine ? engineLabel(engine) : core.name}</b>
        <span className={styles.muted}>{core.name}</span>
        {core.version && <span className={styles.mono}>{core.version}</span>}
        <span className={core.installed === false ? (need.brokenForHosts ? styles.danger : styles.muted) : styles.muted}>{need.brokenForHosts ? words.coreBroken : core.installed === false ? words.coreNotInstalled : words.coreInstalled}</span>
        {need.needed > 0 && <span className={styles.muted}>{words.coreNeeded(need.needed)}</span>}
        {moved && <span className={styles.amber}>{words.coreDrift}</span>}
        <span className={styles.coreActions}>
          {moved && (
            <Button onClick={() => setShown(shown === 'update' ? null : 'update')}>{words.coreHowUpdate}</Button>
          )}
          {showRemove && remove?.kind === 'allowed' && <Button onClick={() => setShown(shown === 'remove' ? null : 'remove')}>{words.coreHowRemove}</Button>}
        </span>
      </div>
      {core.error && <div className={styles.danger}>{core.error}</div>}
      {showRemove && remove?.kind === 'refused' && <div className={styles.note}>{remove.reasons.map((r) => (r.kind === 'hosts' ? words.coreRemoveHosts(r.count) : words.coreRemoveCascade(r.name))).join(' ')}</div>}
      {showRemove && remove?.kind === 'unknown' && <div className={styles.note}>{words.coreRemoveUnknown}</div>}
      {shown === 'update' && moved?.command && (moved.command.kind === 'command' ? <Command text={moved.command.text} {...copy} /> : <div className={styles.note}>{words.coreNoCommand}</div>)}
      {shown === 'remove' && engine && <Command text={coreRemoveCommand(engine).command} {...copy} />}
    </li>
  )
}

export function CoresStep({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const rotate = useRotateHysteriaTls(node.id)
  const [asking, setAsking] = useState(false)
  const reported = node.cores?.cores ? coreRowsInManifestOrder(node.cores.cores) : null
  const hasNative = reported?.some(isNativeHysteria) ?? false
  return (
    <>
      <p className={styles.note}>{words.coresKeep}</p>
      {reported === null ? (
        <div className={styles.note}>
          {(node.intendedEngines ?? []).map(engineLabel).join(', ') || '-'}, {words.coresUnknown}
        </div>
      ) : (
        <ul className={styles.coreList}>
          {reported.map((core, i) => (
            <CoreRow key={`${core.name}-${core.engine ?? ''}`} core={core} node={node} showRemove={firstRowOfEngine(reported, i)} />
          ))}
        </ul>
      )}
      {hasNative && canRotateHysteriaTls(node) && (
        <div className={styles.serviceRow}>
          <span>{words.hysteriaTls}</span>
          <Button variant="warn" onClick={() => setAsking(true)}>
            {words.hysteriaRotate}
          </Button>
        </div>
      )}
      {asking && (
        <Confirm
          title={words.hysteriaRotateTitle}
          labels={{ confirm: words.hysteriaRotate, cancel: words.cancel }}
          state={{ busy: rotate.isPending, error: rotate.error ? failureText(rotate.error, locale) : null }}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            rotate.mutate(undefined, {
              onSuccess: () => {
                toast.show(words.hysteriaRotated)
                setAsking(false)
              },
            })
          }
        >
          {words.hysteriaRotateBody}
        </Confirm>
      )}
    </>
  )
}

export function EgressStep({ node, open, onToggle, memberName, cascadesKnown }: { node: Node; open: boolean; onToggle: () => void; memberName: string | null; cascadesKnown: boolean }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const warp = useWarp(node.id)
  const egress = egressOf(memberName !== null, cascadesKnown, node.warpEnabled)
  const value = { direct: words.egressDirect, warp: words.egressWarp, cascade: words.egressCascade, unknown: words.egressUnknown }[egress]
  return (
    <Step optional title={words.egress} open={open} onToggle={onToggle} value={value}>
      {memberName ? (
        <p className={styles.note}>{words.egressInCascade(memberName)}</p>
      ) : (
        <>
          <Switch
            label={words.warpSwitch}
            checked={node.warpEnabled}
            disabled={warp.isPending || egress === 'unknown'}
            onChange={(on) => warp.mutate(on, { onSuccess: () => toast.show(on ? words.warpOn : words.warpOff), onError: (err) => toast.show(failureText(err, locale), 'failed') })}
          />
          <p className={styles.note}>{words.warpHint}</p>
        </>
      )}
    </Step>
  )
}

export function PolicyStep({ node, value, onChange, open, onToggle }: { node: Node; value: string; onChange: (next: string) => void; open: boolean; onToggle: () => void }) {
  const words = useDict(DICT)
  const policies = useNodePolicies()
  const coverage = policyCoverage(node.cores?.cores)
  const name = policies.data?.policies.find((p) => p.id === value)?.name
  return (
    <Step optional title={words.policy} open={open} onToggle={onToggle} value={value === '' ? words.policyNone : (name ?? '-')}>
      {policies.isError ? (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void policies.refetch()}>
          {words.policiesFailed}
        </QueryFailedLine>
      ) : (
        <Field label={words.policy}>{(a11y) => <Select {...a11y} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: words.policyNone }, ...(policies.data?.policies ?? []).map((p) => ({ value: p.id, label: p.name }))]} />}</Field>
      )}
      <ul className={styles.plainList}>
        {coverage.applied.map((c) => <li key={c}>{words.policyApplies(c)}</li>)}
        {coverage.missing.map((c) => <li key={c} className={styles.amber}>{words.policyNotApplies(c)}</li>)}
        {coverage.unknown.map((c) => <li key={c} className={styles.muted}>{words.policyUnknown(c)}</li>)}
      </ul>
      <p className={styles.note}>{words.policyGoRoutes}</p>
    </Step>
  )
}

function CertRow({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const toast = useToast()
  const rotate = useRotateCert(node.id)
  const [refused, setRefused] = useState<string | null>(null)
  const term = certTerm(node.certNotAfter, now())
  if (!term || term.kind === 'unknown') {
    return (
      <div className={styles.serviceRow}>
        <span>{words.certRow}</span>
        <span className={styles.muted}>{words.certNoAnswer}</span>
      </div>
    )
  }
  const view = certPageView(term, node.agentCanRotate)
  return (
    <div className={styles.serviceBlock}>
      <div className={styles.serviceRow}>
        <span>{words.certRow}</span>
        <span className={term.kind === 'expired' ? styles.danger : term.kind === 'soon' ? styles.amber : styles.muted}>{term.kind === 'expired' ? words.certExpired : words.certUntil(fmtDate(term.notAfter, locale), words.certDays(term.days))}</span>
        {view.button && (
          <Button
            loading={rotate.isPending}
            onClick={() => {
              setRefused(null)
              rotate.mutate(undefined, {
                onSuccess: () => toast.show(words.certRenewed),
                onError: (err) => {
                  const read = certRotateRefusal(err)
                  setRefused(read ? `${words.certRefusal[read.code]}${read.detail ? `: ${read.detail}` : ''}` : failureText(err, locale))
                },
              })
            }}
          >
            {words.certRenew}
          </Button>
        )}
      </div>
      {view.oldAgent && <p className={styles.amber}>{words.certOldAgentHint(fmtDate(term.notAfter, locale))}</p>}
      {view.hint === 'soon' && <p className={styles.note}>{words.certSoonHint}</p>}
      {view.hint === 'expired' && <p className={styles.note}>{words.certExpiredHint}</p>}
      {refused && <p className={styles.danger} role="alert">{refused}</p>}
    </div>
  )
}

function PortsRow({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const check = useExposure(node.id)
  const view = check.data === undefined ? null : exposureView(check.data)
  const text = (() => {
    switch (view?.kind) {
      case undefined:
        return null
      case 'skipped':
        return view.note ? words.exposureSkipped(view.note) : words.exposureSkippedNoNote
      case 'clean':
        return words.exposureClean
      case 'extra':
        return words.exposureExtra(view.ports.join(', '))
      case 'unknown':
        return words.exposureUnknown
    }
  })()
  return (
    <div className={styles.serviceBlock}>
      <div className={styles.serviceRow}>
        <span>{words.ports}</span>
        <Button loading={check.isPending} onClick={() => check.mutate()}>
          {words.portsCheck}
        </Button>
      </div>
      {text && <p className={view?.kind === 'extra' ? styles.amber : styles.note}>{text}</p>}
      {check.isError && <p className={styles.danger} role="alert">{failureText(check.error, locale)}</p>}
    </div>
  )
}

function ConnectRow({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const bindings = useNodeBindings(node.id)
  const test = useNodeConnectTest(node.name)
  const profileIds = [...new Set((bindings.data?.bindings ?? []).map((b) => b.profileId))]
  return (
    <div className={styles.serviceBlock}>
      <div className={styles.serviceRow}>
        <span>{words.connect}</span>
        <Button loading={test.isPending} disabled={profileIds.length === 0} title={profileIds.length === 0 ? words.connectNoHosts : undefined} onClick={() => test.mutate(profileIds)}>
          {words.connectRun}
        </Button>
      </div>
      {test.data?.length === 0 && <p className={styles.note}>{words.connectEmpty}</p>}
      {test.data && test.data.length > 0 && (
        <ul className={styles.plainList}>
          {test.data.map((row, i) => (
            <li key={`${row.hostId ?? row.bindingId}-${row.kind}-${i}`} className={row.ok ? '' : styles.danger}>
              {row.ok ? words.connectOk(`${row.hostRemark} ${row.endpoint}:${row.port}`, row.latencyMs === undefined ? '-' : `${row.latencyMs} ms`) : words.connectBad(`${row.hostRemark} ${row.endpoint}:${row.port}`, row.error ?? '-')}
              {row.probe === 'skip' && ` ${words.connectUdp}`}
            </li>
          ))}
        </ul>
      )}
      {test.isError && <p className={styles.danger} role="alert">{failureText(test.error, locale)}</p>}
    </div>
  )
}

function ConnLogRow({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const log = useConnLog(node.id)
  const clear = useClearConnLog(node.id)
  const [asking, setAsking] = useState(false)
  const view = log.data ? connLogView(log.data as ConnLogTraceResponse) : null
  const head = (() => {
    switch (view?.headline.kind) {
      case undefined:
        return null
      case 'present':
        return words.connLogPresent(view.headline.since ? fmtDateTime(view.headline.since, locale) : '-')
      case 'none':
        return words.connLogNone
      case 'unknown':
        return words.connLogUnknown
    }
  })()
  return (
    <div className={styles.serviceBlock}>
      <div className={styles.serviceRow}>
        <span>{words.connLog}</span>
        <span className={styles.coreActions}>
          <Button loading={log.isFetching} onClick={() => void log.refetch()}>
            {words.connLogRead}
          </Button>
          {view?.canClear && (
            <Button variant="danger" onClick={() => setAsking(true)}>
              {words.connLogClear}
            </Button>
          )}
        </span>
      </div>
      {head && <p className={styles.note}>{head}</p>}
      {view?.lines.filter((l) => l.state === 'failed').map((l) => <p key={l.source} className={styles.danger}>{words.connLogFailed(l.source, l.error ?? '-')}</p>)}
      {log.isError && <p className={styles.danger} role="alert">{failureText(log.error, locale)}</p>}
      {asking && (
        <Confirm title={words.connLogClearTitle} labels={{ confirm: words.connLogClear, cancel: words.cancel }} state={{ busy: clear.isPending, error: clear.error ? failureText(clear.error, locale) : null }} onClose={() => setAsking(false)} onConfirm={() => clear.mutate(undefined, { onSuccess: () => setAsking(false) })}>
          {words.connLogClearBody}
        </Confirm>
      )}
    </div>
  )
}

function ReissueRow({ node }: { node: Node }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const reissue = useReissueBootstrap(node.id)
  const [asking, setAsking] = useState(false)
  const [issued, setIssued] = useState<BootstrapInfo | null>(null)
  return (
    <div className={styles.serviceRow}>
      <span>{words.reissue}</span>
      <Button onClick={() => setAsking(true)}>{words.reissueRun}</Button>
      {asking && (
        <Confirm
          title={words.reissueTitle}
          labels={{ confirm: words.reissueRun, cancel: words.cancel }}
          state={{ busy: reissue.isPending, error: reissue.error ? failureText(reissue.error, locale) : null }}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            reissue.mutate(undefined, {
              onSuccess: (info) => {
                setAsking(false)
                setIssued(info)
              },
            })
          }
        >
          {words.reissueBody}
        </Confirm>
      )}
      {issued && (
        <Dialog title={isPayloadOnly(issued) ? words.payloadOnlyTitle : words.reissueTokenTitle} closeLabel={words.close} onClose={() => setIssued(null)} footer={<Button onClick={() => setIssued(null)}>{words.close}</Button>}>
          <p>{isPayloadOnly(issued) ? words.payloadOnlyBody : words.reissueTokenBody}</p>
          <Command text={issued.command} copyLabel={words.copy} copiedLabel={words.copied} />
        </Dialog>
      )}
    </div>
  )
}

export function ServiceStep({ node }: { node: Node }) {
  return (
    <>
      <CertRow node={node} />
      <PortsRow node={node} />
      <ConnectRow node={node} />
      <ConnLogRow node={node} />
      <ReissueRow node={node} />
    </>
  )
}

export function HostsBlock({ node }: { node: Node }) {
  const words = useDict(DICT)
  const hosts = useNodeHosts(node.id)
  const list = hosts.data?.hosts ?? []
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.hostsOnNode}</h2>
      {hosts.isPending && <QueryLoading label={words.loading} />}
      {hosts.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void hosts.refetch()}>
          {words.hostsFailed}
        </QueryFailedLine>
      )}
      {hosts.data && list.length === 0 && <p className={styles.note}>{words.hostsEmpty}</p>}
      {list.length > 0 && (
        <ul className={styles.plainList}>
          {list.map((host) => (
            <li key={host.id}>
              <Link className={styles.linkPlain} to={`/hosts/${host.id}`}>
                {host.remark}
              </Link>
              {host.hiddenByCascade && <span className={styles.muted}> · {words.hostHidden(host.hiddenByCascade.cascadeName)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
