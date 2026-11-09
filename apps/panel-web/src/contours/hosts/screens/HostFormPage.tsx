import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import styles from '@/contours/hosts/components/hosts.module.css'
import { DICT } from '@/contours/hosts/dict'
import { useBindingsList, useCreateHost, useDeleteHost, useFleet, useGrantHost, useHostFields, useHostFormats, useHostsList, useOldSquads, usePortCheck, useProfilesList, useUpdateHost, type GrantFailure } from '@/contours/hosts/hooks/useHosts'
import { draftOfHost, draftProblems, emptyDraft, hostCreateFields, hostUpdateBody, type HostDraft } from '@/contours/hosts/lib/hostForm'
import { hostPortPlan } from '@/contours/hosts/lib/hostPortPlan'
import { nodePortClaims } from '@/contours/hosts/lib/portClaims'
import { engineLabel } from '@/lib/domain/engines'
import { nodeHealth } from '@/lib/domain/overview'
import { ALL_SQUAD_ID, grantHostBody, lastHostCheck, squadReach } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { hostPortPayload, profileNotOnNode, type Host, type HostPortMove } from '@/lib/old/hosts'
import { nodeCoreBlocks, nodeCoreFit } from '@/lib/old/nodeCoreFit'
import { portRefusalOf, type PortOwner } from '@/lib/old/portCheck'
import { profileTransport } from '@/lib/old/profileTransport'
import { sniMismatch } from '@/lib/old/profiles'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { Flag } from '@/ui/Flag/Flag'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { RadioRow } from '@/ui/RadioRow/RadioRow'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { Step } from '@/ui/Step/Step'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

const ALPN = ['h2', 'http/1.1', 'h3'] as const
const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'edge', 'ios', 'android', 'random', 'randomized']

const numberOr = (text: string): number | '' => (text.trim() === '' || Number.isNaN(Number(text)) ? '' : Number(text))

function HostForm({ host }: { host: Host | null }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [url] = useSearchParams()
  const isNew = host === null
  const hosts = useHostsList()
  const bindings = useBindingsList()
  const fleet = useFleet()
  const profiles = useProfilesList()
  const squads = useOldSquads()
  const create = useCreateHost()
  const update = useUpdateHost(host?.id ?? '')
  const remove = useDeleteHost()
  const grant = useGrantHost()

  const binding = host ? bindings.data?.bindings.find((b) => b.id === host.bindingId) : undefined
  const [initial, setInitial] = useState<HostDraft>(() => (host ? draftOfHost(host) : emptyDraft()))
  const [draft, setDraft] = useState<HostDraft>(initial)
  const [profileId, setProfileId] = useState<string | null>(url.get('profileId'))
  const [nodeId, setNodeId] = useState<string | null>(url.get('nodeId'))
  const [portText, setPortText] = useState('')
  const [clientPortText, setClientPortText] = useState<string | null>(null)
  const [portMove, setPortMove] = useState<HostPortMove>('host')
  const [open, setOpen] = useState<string | null>(isNew ? 'profile' : null)
  const [nodeFind, setNodeFind] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)
  const [squadFind, setSquadFind] = useState('')
  const [grantIds, setGrantIds] = useState<string[]>([])
  const [grantFailed, setGrantFailed] = useState<GrantFailure[]>([])
  const [refusal, setRefusal] = useState<string | null>(null)
  const [portOwners, setPortOwners] = useState<PortOwner[] | null>(null)
  const [sniExpected, setSniExpected] = useState<string[] | null>(null)
  const [asking, setAsking] = useState(false)
  const patch = (next: Partial<HostDraft>) => {
    setDraft((d) => ({ ...d, ...next }))
    setRefusal(null)
    if ('sni' in next) setSniExpected(null)
  }

  const effectiveProfileId = binding?.profileId ?? profileId
  const effectiveNodeId = binding?.nodeId ?? nodeId
  const port: number | '' = portText !== '' ? numberOr(portText) : (binding?.port ?? '')
  const storedClient = host?.portOverride ?? null
  const clientPort: number | '' = clientPortText === null ? (storedClient ?? '') : numberOr(clientPortText)
  const profile = profiles.data?.profiles.find((p) => p.id === effectiveProfileId)
  const node = fleet.data?.nodes.find((n) => n.id === effectiveNodeId)
  const transport = profileTransport(profile)
  const allBindings = bindings.data?.bindings ?? []
  const allHosts = hosts.data?.hosts ?? []
  const portMoved = !isNew && binding !== undefined && port !== '' && port !== binding.port
  const check = usePortCheck(effectiveNodeId, port, transport, binding?.id, effectiveProfileId !== null && (isNew || portMoved))
  const fields = useHostFields(effectiveProfileId)
  const formats = useHostFormats(effectiveProfileId, draft.securityLayer)
  const map = fields.data?.fields
  const can = (key: string) => map?.[key]?.supported === true
  const clientKeys = ['sniOverride', 'hostHeaderOverride', 'pathOverride', 'fingerprintOverride', 'alpn', 'securityLayer', 'allowInsecure']
  const nothing = map !== undefined && !clientKeys.some(can)

  const claims = nodePortClaims(allBindings, allHosts, port, transport, host?.id, isNew || portMove === 'host' ? effectiveProfileId : null)

  const plan = hostPortPlan({ bindings: allBindings, hosts: allHosts, profileId: effectiveProfileId, nodeId: effectiveNodeId, port, self: host ? { hostId: host.id, bindingId: host.bindingId } : null, move: portMove })
  const planText = (() => {
    switch (plan?.kind) {
      case undefined:
        return null
      case 'join':
        return words.portPlanJoin(plan.hosts.join(', '))
      case 'newInbound':
        return words.portPlanNew(plan.ports.join(', '))
      case 'split':
        return words.portPlanSplit(plan.from, plan.others.join(', '))
      case 'moveAll':
        return words.portPlanMove(plan.from, plan.others.join(', '))
    }
  })()
  const owners = portOwners ?? check.data?.conflicts ?? []
  const ownerWord = (o: PortOwner) => (o.kind === 'profile' ? words.portBusyProfile(o.name, o.port) : o.kind === 'cascade' ? words.portBusyCascade(o.name, o.port) : words.portBusyCore(o.port))
  const portBusy = owners.length > 0

  const problems = draftProblems(draft)
  const body = hostUpdateBody(initial, draft)
  const portChanged = host && binding ? hostPortPayload({ listenPort: binding.port, clientPort: storedClient }, { port, clientPort }, portMove) : {}
  const changed = Object.keys(body).length > 0 || Object.keys(portChanged).length > 0
  const invalid = problems.remark || problems.address !== null || problems.description || portBusy || (sniExpected !== null && !sniExpected.includes(draft.sni.trim()))
  const ready = isNew ? effectiveProfileId !== null && effectiveNodeId !== null && port !== '' && !invalid : changed && !invalid

  const fail = (err: unknown) => {
    const taken = portRefusalOf(err)
    if (taken) {
      setPortOwners(taken.conflicts)
      setOpen('node')
      return
    }
    const expected = sniMismatch(err)
    if (expected) {
      setSniExpected(expected)
      setOpen('client')
      return
    }
    const core = profileNotOnNode(err)
    setRefusal(core ? words.coreGate(core.nodeName, engineLabel(core.neededEngine)) : failureText(err, locale))
  }

  const say = (err: unknown) => failureText(err, locale)
  const runGrant = (hostId: string, then?: () => void) => {
    const pid = effectiveProfileId
    if (!pid || grantIds.length === 0) {
      then?.()
      return
    }
    grant.mutate(
      { hostId, profileId: pid, squadIds: grantIds, bodyOf: grantHostBody, say },
      {
        onSuccess: (failures) => {
          setGrantFailed(failures)
          if (failures.length === 0) {
            setGrantIds([])
            if (!then) toast.show(words.grantDone)
          }
          then?.()
        },
        onError: (err) => {
          setGrantFailed([{ name: words.stepSquads, message: say(err) }])
          then?.()
        },
      },
    )
  }

  const submit = () => {
    setRefusal(null)
    setPortOwners(null)
    if (isNew) {
      if (!effectiveProfileId || !effectiveNodeId || port === '') return
      create.mutate(
        { profileId: effectiveProfileId, nodeId: effectiveNodeId, ...hostCreateFields(draft, map), ...hostPortPayload(null, { port, clientPort }) },
        {
          onSuccess: (saved) =>
            runGrant(saved.id, () => {
              toast.show(words.created)
              void navigate(`/hosts/${saved.id}`, { replace: true })
            }),
          onError: fail,
        },
      )
      return
    }
    update.mutate(
      { ...body, ...portChanged },
      {
        onSuccess: () => {
          setInitial(draft)
          setPortText('')
          setClientPortText(null)
          toast.show(words.saved)
          if (grantIds.length > 0 && host) runGrant(host.id)
        },
        onError: fail,
      },
    )
  }

  const nodeRows = (fleet.data?.nodes ?? [])
    .map((n) => {
      const fit = profile ? nodeCoreFit(n, profile.effectiveEngine) : null
      const blocked = fit !== null && nodeCoreBlocks(fit)
      const taken = claims.get(n.id)
      const down = nodeHealth(n.status) === 'problem'
      const reason = !profile ? null : blocked ? words.fitBlocked : port === '' ? words.portUnset : taken ? words.portTaken(taken.label, taken.host) : words.portFree(port)
      return { node: n, blocked, taken: taken !== undefined, down, reason }
    })
    .filter((r) => (!onlyFree || (!r.blocked && !r.taken)) && `${r.node.name} ${r.node.address}`.toLowerCase().includes(nodeFind.trim().toLowerCase()))

  const allSquads = squads.data?.squads ?? []
  const squadRows = allSquads.filter((s) => s.name.toLowerCase().includes(squadFind.trim().toLowerCase()))
  const notCarried = formats.data?.formats.filter((f) => !f.carried) ?? []
  const carried = formats.data?.formats.filter((f) => f.carried) ?? []
  const carriedOn = carried.filter((f) => !draft.disabledFormats.includes(f.format))

  // F-32: squads not in yet or failed is "cannot tell", and the delete stays closed.
  const lastOf = host ? lastHostCheck([host.id], squads.data?.squads) : []
  const deleteLock = lastOf === null ? words.deleteSquadsUnknown : lastOf.length > 0 ? words.deleteLocked(lastOf.join(', ')) : null
  const lastOnNode = host && binding ? allHosts.filter((h) => h.id !== host.id && allBindings.find((b) => b.id === h.bindingId)?.nodeId === binding.nodeId).length === 0 : false
  const addressShown = draft.address.trim() || node?.address.split(':')[0] || null

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{host ? host.remark : words.newHost}</h1>
      {grantFailed.length > 0 && (
        <Banner title={words.grantBannerEdit(grantFailed.map((f) => `${f.name}: ${f.message}`).join('; '))} action={host ? <Button loading={grant.isPending} onClick={() => runGrant(host.id)}>{words.grantRetry}</Button> : undefined}>
          {null}
        </Banner>
      )}
      {host?.hiddenByCascade && node && <Banner title={words.stateHidden}>{words.hiddenBanner(node.name, host.hiddenByCascade.cascadeName)}</Banner>}
      {host && node && nodeHealth(node.status) === 'problem' && <Banner tone="danger" title={words.stateDown}>{words.downBanner}</Banner>}
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.stepBasics}</h2>
            <Field label={words.name} error={problems.remark ? words.nameRequired : undefined}>{(a11y) => <Input {...a11y} autoFocus={isNew} value={draft.remark} onChange={(e) => patch({ remark: e.target.value })} />}</Field>
            <div className={styles.switches}>
              <Switch label={words.enabled} checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
              <Switch label={words.hidden} checked={draft.hidden} onChange={(hidden) => patch({ hidden })} />
            </div>
            <Field label={words.description} error={problems.description ? words.descriptionBad : undefined}>{(a11y) => <Input {...a11y} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
          </section>
          <Step optional={!isNew} title={words.stepProfile} open={open === 'profile'} onToggle={() => setOpen(open === 'profile' ? null : 'profile')} value={profile?.name ?? '-'}>
            {isNew ? (
              profiles.data?.profiles.length === 0 ? (
                <>
                  <p className={styles.note}>{words.noProfiles}</p>
                  <div>
                    <Button onClick={() => void navigate('/profiles/new')}>{words.makeProfile}</Button>
                  </div>
                </>
              ) : (
                <Field label={words.stepProfile}>{(a11y) => <Select {...a11y} value={profileId ?? ''} onChange={(e) => setProfileId(e.target.value || null)} options={[{ value: '', label: words.profilePick }, ...(profiles.data?.profiles ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.protocol})` }))]} />}</Field>
              )
            ) : (
              <p className={styles.note}>
                {profile?.name ?? '-'} {profile && <Link className={styles.link} to={`/profiles/${profile.id}`}>{words.open}</Link>}. {words.profileLocked}
              </p>
            )}
          </Step>
          <Step optional={!isNew} title={words.stepNode} open={open === 'node'} onToggle={() => setOpen(open === 'node' ? null : 'node')} value={`${node?.name ?? '-'}${port === '' ? '' : `:${port}`}`}>
            <div className={styles.twoFields}>
              <Field label={words.port} error={portBusy ? words.portBusy(owners.map(ownerWord).join(', ')) : undefined} hint={!portBusy && check.data?.ok ? words.portCheckFree : undefined}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => {
                      setPortText(e.target.value)
                      setPortOwners(null)
                    }}
                  />
                )}
              </Field>
              <Field label={words.clientPort} hint={words.clientPortHint}>{(a11y) => <Input {...a11y} inputMode="numeric" value={clientPort} onChange={(e) => setClientPortText(e.target.value)} />}</Field>
            </div>
            {planText && <p className={styles.note}>{planText}</p>}
            {portMoved && (
              <>
                <RadioRow name="portMove" title={words.portMoveHost} checked={portMove === 'host'} onSelect={() => setPortMove('host')} />
                <RadioRow name="portMove" title={words.portMoveBinding} checked={portMove === 'binding'} onSelect={() => setPortMove('binding')} />
                <p className={styles.amber}>{words.portFreshLead}</p>
              </>
            )}
            {isNew ? (
              <>
                {!profile && <p className={styles.note}>{words.notYetChecked}</p>}
                <div className={styles.twoFields}>
                  <input className={styles.search} aria-label={words.nodeFind} placeholder={words.nodeFind} value={nodeFind} onChange={(e) => setNodeFind(e.target.value)} />
                  {profile && <Switch label={words.onlyFree} checked={onlyFree} onChange={setOnlyFree} />}
                </div>
                <div className={styles.list}>
                  {nodeRows.map((r) => (
                    <RadioRow key={r.node.id} name="node" title={r.node.name} description={[r.reason, r.down ? words.downNode : null].filter(Boolean).join(' · ') || r.node.address} checked={nodeId === r.node.id} closedReason={r.blocked || r.taken ? (r.reason ?? undefined) : undefined} onSelect={() => setNodeId(r.node.id)} />
                  ))}
                </div>
              </>
            ) : (
              <p className={styles.note}>{words.nodeLocked}</p>
            )}
          </Step>
          <Step optional title={words.stepAddress} open={open === 'address'} onToggle={() => setOpen(open === 'address' ? null : 'address')} value={draft.address || words.addressFromNode}>
            <Field label={words.addressLabel} hint={words.addressHint} error={problems.address ? words.addressProblem[problems.address] : undefined}>{(a11y) => <Input {...a11y} value={draft.address} onChange={(e) => patch({ address: e.target.value })} />}</Field>
            {draft.address.trim() && node && !problems.address && <p className={styles.note}>{words.aRecord(draft.address.trim(), node.address.split(':')[0] ?? '')}</p>}
          </Step>
          <Step optional title={words.stepClient} open={open === 'client'} onToggle={() => setOpen(open === 'client' ? null : 'client')} value={nothing ? words.nothingValue : undefined}>
            {effectiveProfileId === null && <p className={styles.note}>{words.pickProfileFirst}</p>}
            {fields.isError && (
              <QueryFailedLine retryLabel={words.retry} onRetry={() => void fields.refetch()}>
                {words.fieldsFailed}
              </QueryFailedLine>
            )}
            {nothing && (
              <p className={styles.note}>
                {words.nothingToChange}
                {map?.sniOverride?.reason ? `: ${map.sniOverride.reason}` : ''}
              </p>
            )}
            {can('sniOverride') && <Field label={words.sni} error={sniExpected ? words.sniRequiredOne(sniExpected.join(', ')) : undefined} hint={map?.sniOverride?.inherited ? words.inherited(String(map.sniOverride.inherited)) : undefined}>{(a11y) => <Input {...a11y} value={draft.sni} onChange={(e) => patch({ sni: e.target.value })} />}</Field>}
            {can('hostHeaderOverride') && <Field label={words.hostHeader} hint={map?.hostHeaderOverride?.inherited ? words.inherited(String(map.hostHeaderOverride.inherited)) : words.sniFollows}>{(a11y) => <Input {...a11y} value={draft.hostHeader} onChange={(e) => patch({ hostHeader: e.target.value })} />}</Field>}
            {can('pathOverride') && <Field label={words.path} hint={map?.pathOverride?.inherited ? words.inherited(String(map.pathOverride.inherited)) : undefined}>{(a11y) => <Input {...a11y} value={draft.path} onChange={(e) => patch({ path: e.target.value })} />}</Field>}
            {can('fingerprintOverride') && <Field label={words.fingerprint}>{(a11y) => <Select {...a11y} value={draft.fingerprint} onChange={(e) => patch({ fingerprint: e.target.value })} options={[{ value: '', label: words.fpInherit }, ...FINGERPRINTS.map((f) => ({ value: f, label: f }))]} />}</Field>}
            {can('alpn') && (
              <div className={styles.switches}>
                <span className={styles.muted}>{words.alpn}</span>
                {ALPN.map((a) => (
                  <label key={a} className={styles.checkLabel}>
                    <Check label={a} checked={draft.alpn.includes(a)} onChange={(on) => patch({ alpn: on ? [...draft.alpn, a] : draft.alpn.filter((x) => x !== a) })} />
                    {a}
                  </label>
                ))}
              </div>
            )}
            {can('securityLayer') && <Segmented<HostDraft['securityLayer']> label={words.security} value={draft.securityLayer} onChange={(securityLayer) => patch({ securityLayer })} options={[{ value: 'default', label: words.layerDefault }, { value: 'tls', label: words.layerTls }, { value: 'none', label: words.layerNone }]} />}
            {can('allowInsecure') && <Switch label={words.allowInsecure} checked={draft.allowInsecure} onChange={(allowInsecure) => patch({ allowInsecure })} />}
          </Step>
          <Step optional title={words.stepFormats} open={open === 'formats'} onToggle={() => setOpen(open === 'formats' ? null : 'formats')} value={formats.data ? words.formatsCount(carriedOn.length, formats.data.formats.length, carried.length - carriedOn.length) : undefined}>
            {effectiveProfileId === null && <p className={styles.note}>{words.pickProfileFirst}</p>}
            {(formats.isError || formats.data === null) && <p className={styles.note}>{words.formatsFailed}</p>}
            <div className={styles.twoFields}>
              {carried.map((f) => (
                <label key={f.format} className={styles.checkLabel}>
                  <Check label={f.format} checked={!draft.disabledFormats.includes(f.format)} onChange={(on) => patch({ disabledFormats: on ? draft.disabledFormats.filter((x) => x !== f.format) : [...draft.disabledFormats, f.format] })} />
                  {f.format}
                </label>
              ))}
            </div>
            {notCarried.length > 0 && (
              <p className={styles.note}>
                {words.formatsNotCarried}: {notCarried.map((f) => f.format).join(', ')}
              </p>
            )}
          </Step>
          <Step optional title={words.stepSquads} open={open === 'squads'} onToggle={() => setOpen(open === 'squads' ? null : 'squads')} value={grantIds.length > 0 ? words.squadsSome(grantIds.length) : words.squadsNone}>
            <input className={styles.search} aria-label={words.squadFind} placeholder={words.squadFind} value={squadFind} onChange={(e) => setSquadFind(e.target.value)} />
            <div className={styles.list}>
              {squadRows.map((s) => {
                const isAll = s.id === ALL_SQUAD_ID
                const reach = squadReach(s)
                return (
                  <label key={s.id} className={styles.checkLabel}>
                    <Check label={s.name} disabled={isAll} checked={isAll || grantIds.includes(s.id)} onChange={(on) => setGrantIds(on ? [...grantIds, s.id] : grantIds.filter((x) => x !== s.id))} />
                    {s.name}
                    <span className={styles.muted}>{isAll ? words.squadAllLocked : reach === 'wide' ? words.squadWide : words.squadUsers(fmtNumber(s.memberCount ?? 0, locale))}</span>
                  </label>
                )
              })}
            </div>
          </Step>
          {refusal && <Banner tone="danger">{refusal}</Banner>}
          <div className={styles.actions}>
            {host && (
              <Button variant="danger" disabled={deleteLock !== null} title={deleteLock ?? undefined} onClick={() => setAsking(true)}>
                {words.delete}
              </Button>
            )}
            {host && deleteLock && <span className={styles.note}>{deleteLock}</span>}
            <span className={styles.spacer} />
            <Button onClick={() => void navigate('/hosts')}>{words.cancel}</Button>
            <Button variant="primary" disabled={!ready && !(host && grantIds.length > 0 && !changed)} loading={create.isPending || update.isPending || grant.isPending} onClick={() => (host && !changed ? runGrant(host.id) : submit())}>
              {isNew ? words.createShort : words.save}
            </Button>
          </div>
        </div>
        <aside className={styles.right}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.rightTitle}</h2>
            {!profile && !node ? (
              <p className={styles.note}>{words.rightNothing}</p>
            ) : (
              <dl className={styles.facts}>
                <dt>{words.rightName}</dt>
                <dd>{draft.remark || '-'}</dd>
                <dt>{words.rightAddress}</dt>
                <dd>{addressShown ?? '-'}</dd>
                <dt>{words.rightPort}</dt>
                <dd>{clientPort || port || '-'}</dd>
              </dl>
            )}
            {node && (
              <p className={styles.flagLine}>
                <Flag code={node.countryCode} /> {node.countryCode ? words.rightFlag(node.countryCode) : words.rightFlagNone}
              </p>
            )}
          </section>
        </aside>
      </div>
      {asking && host && (
        <Confirm
          title={words.deleteTitle(host.remark)}
          labels={{ confirm: words.delete, cancel: words.cancel }}
          state={{ busy: remove.isPending, error: remove.error ? failureText(remove.error, locale) : deleteLock }}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            if (deleteLock !== null) return
            remove.mutate(host.id, {
              onSuccess: () => {
                toast.show(words.deleted(host.remark))
                void navigate('/hosts')
              },
            })
          }}
        >
          {words.deleteBody} {lastOnNode && words.deleteLast}
        </Confirm>
      )}
    </div>
  )
}

export default function HostFormPage() {
  const { id } = useParams()
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const hosts = useHostsList()
  if (!id) return <HostForm host={null} />
  if (hosts.isPending) return <QueryLoading label={words.loading} />
  if (hosts.isError) return <QueryFailed title={words.failedTitle} body={failureText(hosts.error, locale)} retryLabel={words.retry} onRetry={() => void hosts.refetch()} />
  const host = hosts.data.hosts.find((h) => h.id === id)
  if (!host) return <QueryFailed title={words.goneTitle} body={words.goneBody} retryLabel={words.backToList} onRetry={() => void navigate('/hosts')} />
  return <HostForm key={host.id} host={host} />
}
