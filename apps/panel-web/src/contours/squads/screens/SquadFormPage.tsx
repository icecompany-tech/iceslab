import { useMemo, useState, type ChangeEvent } from 'react'
import { userScopeGap } from '@iceslab/shared'
import { useNavigate, useParams } from 'react-router-dom'
import { isCascadeEntry } from '@/contours/squads/lib/squadCascades'
import { Icon } from '@/ui/Icon/Icon'
import { CascadesBlock } from '@/contours/squads/components/CascadesBlock'
import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { fetchMembers, useBindingsAll, useCascadesAll, useCreateSquad, useDeleteSquad, useFleet, useHostsAll, useOldSquads, usePresetsAll, useProfilesAll, useRoutePoliciesAll, useUpdateSquad } from '@/contours/squads/hooks/useSquadsData'
import { draftOfSquad, droppedProfiles, membersBlockingEmpty, membersInEmptySquads, squadCreateBody, squadNameValid, squadUpdateBody, type HostRef, type SquadDraft } from '@/contours/squads/lib/squadBody'
import { ALL_SQUAD_ID, squadReach } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { presetChoiceRows } from '@/lib/old/routingPresets'
import type { Squad } from '@/lib/old/squads'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { Flag } from '@/ui/Flag/Flag'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const NAMES_SHOWN = 5

type Ask = { kind: 'empty' } | { kind: 'createEmpty' } | { kind: 'narrow'; users: string; squads: string } | { kind: 'dropped'; names: string }

function SquadForm({ squad, squads, hostRefs }: { squad: Squad | null; squads: readonly Squad[]; hostRefs: readonly HostRef[] }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const hosts = useHostsAll()
  const bindings = useBindingsAll()
  const nodes = useFleet()
  const profiles = useProfilesAll()
  const policies = useRoutePoliciesAll()
  const presets = usePresetsAll()
  const cascades = useCascadesAll()
  const [search, setSearch] = useState('')
  const [onlyPicked, setOnlyPicked] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const create = useCreateSquad()
  const update = useUpdateSquad(squad?.id ?? '')
  const remove = useDeleteSquad()
  const readOnly = squad?.id === ALL_SQUAD_ID
  const reach = squad ? squadReach(squad) : null
  const [initial, setInitial] = useState<SquadDraft>(() => draftOfSquad(squad, hostRefs))
  const [draft, setDraft] = useState<SquadDraft>(initial)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [asks, setAsks] = useState<Ask[]>([])
  const [checking, setChecking] = useState(false)
  const [asking, setAsking] = useState(false)
  const patch = (next: Partial<SquadDraft>) => {
    setDraft((d) => ({ ...d, ...next }))
    setRefusal(null)
  }
  const wideLocked = reach === 'wide' && !draft.hostsTouched
  const hostRows = useMemo(() => {
    const bindingById = new Map((bindings.data?.bindings ?? []).map((b) => [b.id, b]))
    const nodeById = new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n]))
    const profileById = new Map((profiles.data?.profiles ?? []).map((p) => [p.id, p]))
    return (hosts.data?.hosts ?? []).map((host) => {
      const binding = bindingById.get(host.bindingId)
      return { host, binding, node: binding ? nodeById.get(binding.nodeId) : undefined, profile: binding ? profileById.get(binding.profileId) : undefined }
    })
  }, [hosts.data, bindings.data, nodes.data, profiles.data])

  const body = squad ? squadUpdateBody(initial, draft, hostRefs) : null
  const changed = squad ? Object.keys(body ?? {}).length > 0 : true
  const nameBad = !squadNameValid(draft.name)
  const deviceBad = draft.deviceLimit.trim() !== '' && !/^\d+$/.test(draft.deviceLimit.trim())
  const names = (list: readonly string[]) => (list.length > NAMES_SHOWN ? `${list.slice(0, NAMES_SHOWN).join(', ')} ${words.andMore(list.length - NAMES_SHOWN)}` : list.join(', '))
  const profileNameOf = (id: string) => profiles.data?.profiles.find((p) => p.id === id)?.name ?? id.slice(0, 8)

  const send = () => {
    setAsks([])
    const onError = (err: unknown) => setRefusal(failureText(err, locale))
    if (squad && body) {
      update.mutate(body, {
        onSuccess: () => {
          setInitial({ ...draft, hostsTouched: false })
          setDraft((d) => ({ ...d, hostsTouched: false }))
          toast.show(words.saved)
        },
        onError,
      })
    } else {
      create.mutate(squadCreateBody(draft, hostRefs), {
        onSuccess: (saved) => {
          toast.show(words.createdDone(saved.name))
          void navigate(`/squads/${saved.id}`, { replace: true })
        },
        onError,
      })
    }
  }

  const submit = async () => {
    setRefusal(null)
    if (!squad) {
      if (draft.picked.length === 0) setAsks([{ kind: 'createEmpty' }])
      else send()
      return
    }
    const nextAsks: Ask[] = []
    const listsMove = body?.hostIds !== undefined
    if (listsMove) {
      const emptying = body?.hostIds?.length === 0
      const narrowingFromNothing = !emptying && squad.hostIds.length === 0
      if (squad.memberCount > 0 && (emptying || narrowingFromNothing)) {
        setChecking(true)
        try {
          const members = await fetchMembers(squad.id)
          if (emptying) {
            const blocked = membersBlockingEmpty(squad.id, members, squads)
            if (blocked.usernames.length > 0) {
              setRefusal(words.emptyBan(names(blocked.usernames), names(blocked.squadNames)))
              return
            }
          } else {
            const inEmpty = membersInEmptySquads(squad.id, members, squads)
            if (inEmpty.usernames.length > 0) nextAsks.push({ kind: 'narrow', users: names(inEmpty.usernames), squads: names(inEmpty.squadNames) })
          }
        } catch {
          setRefusal(words.membersFailed)
          return
        } finally {
          setChecking(false)
        }
      }
      if (emptying) nextAsks.push({ kind: 'empty' })
      const dropped = droppedProfiles(squad.profileIds, body?.hostIds ?? [], hostRefs)
      if (!emptying && dropped.length > 0) nextAsks.push({ kind: 'dropped', names: names(dropped.map(profileNameOf)) })
    }
    if (nextAsks.length > 0) setAsks(nextAsks)
    else send()
  }

  const ask = asks[0]
  const toggle = (id: string, on: boolean) => patch({ hostsTouched: true, picked: on ? [...draft.picked, id] : draft.picked.filter((h) => h !== id) })
  const presetRows = presetChoiceRows(draft.preset, presets.data?.presets, { inherit: words.presetInherit, unnamed: words.presetUnnamed, builtInName: (id) => words.presetNames[id] ?? id })
  const handedOf = (id: string) => readOnly || draft.picked.includes(id)
  const entryOf = (r: typeof hostRows[number]) => r.binding && r.profile && cascades.data?.cascades.some(c => isCascadeEntry(c,r.binding!.nodeId,r.profile!.protocol))
  const allowed = hostRows.filter(r => r.host.enabled && !r.host.hiddenByCascade && !r.host.isHidden)
  const direct = hostRows.filter(r => !r.host.hiddenByCascade && !r.host.isHidden && !entryOf(r))
  const selected = allowed.filter(r => handedOf(r.host.id))
  const hostCount = readOnly || wideLocked ? words.hostsAll(selected.length) : words.hostCount(selected.length, allowed.length)
  const countryName = new Intl.DisplayNames([locale], {type:'region'})
  const groups = new Map<string, typeof direct>()
  for (const r of direct) {
    const needle = search.trim().toLowerCase()
    if (onlyPicked && !handedOf(r.host.id)) continue
    if (needle && ![r.host.remark,r.node?.name,r.profile?.name,r.profile?.protocol,r.binding?.port,r.host.portOverride].join(' ').toLowerCase().includes(needle)) continue
    const code = r.node?.countryCode?.toUpperCase() ?? ''
    const group = groups.get(code) ?? []
    group.push(r)
    groups.set(code,group)
  }
  const isOpen = (code:string) => expanded[code] ?? (!!squad && !readOnly && code === [...groups.keys()][0])
  const setGroup = (list:typeof direct,on:boolean) => {
    const change = new Set(list.filter(r=>r.host.enabled).map(r => r.host.id))
    patch({hostsTouched:true,picked:on ? [...new Set([...draft.picked,...change])] : draft.picked.filter(id => !change.has(id))})
  }
  const chosenCascades = cascades.data?.cascades.filter(c => c.enabled && selected.some(r=>r.binding && r.profile && isCascadeEntry(c,r.binding.nodeId,r.profile.protocol)) && !draft.exitAcl.some(a => a.cascadeId===c.id && !(a.directionIds?.length || a.exitNodeIds?.length)))
  const profileLabels = (wideLocked ? squad?.profileIds ?? [] : [...new Set(selected.flatMap(r=>r.profile?.id ?? []))]).map(profileNameOf)
  const isPending = create.isPending || update.isPending || checking
  if (nodes.isPending || profiles.isPending || cascades.isPending) return <QueryLoading label={words.loading} />

  return (
    <div className={styles.page}>
      <div className={styles.formHeader}>
        <Button size="md" aria-label={words.backToList} onClick={()=>void navigate('/squads')}><Icon name="chevronLeft"/></Button>
        <h1 className={styles.pageTitle}>{squad ? squad.name : words.newSquad}</h1>
        {squad && <small>{fmtNumber(squad.memberCount,locale)} {words.userUnit(squad.memberCount)}</small>}
        <span className={styles.spacer}/>
        {changed && !readOnly && draft.name && <small className={styles.dirty}>{words.unsaved}</small>}
        {!readOnly && <div className={styles.formActions}><Button size="md" onClick={()=>void navigate('/squads')}>{words.cancel}</Button>
          <Button size="md" variant="primary" disabled={!changed || nameBad || deviceBad} loading={isPending} onClick={()=>void submit()}>{squad ? words.save : words.create}</Button></div>}
      </div>
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel + " " + styles.primaryFields}>
            <div className={styles.blockHead}><h2 className={styles.panelTitle}>{words.blockMain}</h2>{readOnly && <small>{words.system}</small>}</div>
            {readOnly && <p className={styles.note}>{words.allBody}</p>}
            <div className={styles.twoFields}>
            <Field label={words.name} error={!readOnly && nameBad && draft.name !== '' ? words.nameRule : undefined} hint={squad ? undefined : words.nameRule}>{(a11y) => <Input {...a11y} readOnly={readOnly} autoFocus={!squad} placeholder={words.nameExample} value={draft.name} onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })} />}</Field>
            <Field label={words.description}>{(a11y) => <Input {...a11y} readOnly={readOnly} placeholder={words.optional} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
            </div>
            <div className={styles.twoFields}>
              <Field label={words.preset} hint={words.presetHint}>{(a11y) => <Select {...a11y} disabled={readOnly} value={draft.preset} onChange={(e) => patch({ preset: e.target.value })} options={presetRows} />}</Field>
              <Field label={words.deviceLimit} hint={words.deviceLimitHint} error={deviceBad ? words.deviceLimitBad : undefined}>{(a11y) => <Input {...a11y} readOnly={readOnly} inputMode="numeric" placeholder={words.rightLimitNone} value={draft.deviceLimit} onChange={(e) => patch({ deviceLimit: e.target.value })} />}</Field>
            </div>
          </section>
          <section className={styles.panel+" "+styles.rowsPanel}>
            <header className={styles.rowsHeader}><div className={styles.blockHead}>
              <h2 className={styles.panelTitle}>{words.blockHosts}</h2>
              <span className={styles.muted}>{readOnly ? words.hostsAll(direct.filter(r=>r.host.enabled).length) : words.hostCount(direct.filter(r => r.host.enabled && handedOf(r.host.id)).length, direct.filter(r => r.host.enabled).length)}</span>
              {!readOnly && <div className={styles.hostToggle}>{[false,true].map(value=><button type="button" key={String(value)} aria-pressed={onlyPicked===value} onClick={()=>setOnlyPicked(value)}>{value?words.picked:words.all}</button>)}</div>}
            </div>
            <p className={styles.note}>{words.blockHostsBody}</p></header>
            {reach === 'wide' && (
              <Banner
                title={words.wideTitle}
                action={
                  draft.hostsTouched ? (
                    <Button onClick={() => patch({ hostsTouched: false, picked: initial.picked })}>{words.restore}</Button>
                  ) : (
                    <Button onClick={() => patch({ hostsTouched: true })}>{words.chooseByHand}</Button>
                  )
                }
              >
                {words.wideBody(allowed.filter(r => initial.picked.includes(r.host.id)).length)}
              </Banner>
            )}
            {reach === 'empty' && <Banner title={words.emptyHostsTitle}>{words.emptyHostsBody}</Banner>}
            {(hosts.isError || bindings.isError) && (
              <QueryFailedLine
                retryLabel={words.retry}
                onRetry={() => {
                  void hosts.refetch()
                  void bindings.refetch()
                }}
              >
                {words.hostsFailed}
              </QueryFailedLine>
            )}
            {hosts.data && hostRows.length === 0 && <p className={styles.note}>{words.hostsNone}</p>}
            {!readOnly && <div className={styles.hostTools}>
              <Input aria-label={words.findHost} placeholder={words.findHost} value={search} onChange={e=>setSearch(e.target.value)}/>
              {!wideLocked && <button type="button" onClick={()=>setGroup([...groups.values()].flat(),true)}>{words.selectAll}</button>}
              <button type="button" onClick={()=>setExpanded(Object.fromEntries([...groups.keys()].map(code=>[code,![...groups.keys()].some(isOpen)])))}>{[...groups.keys()].some(isOpen)?words.collapseAll:words.expandAll}</button>
            </div>}
            {[...groups].map(([code,group])=>{
              const usable=group.filter(r=>r.host.enabled)
              const count=usable.filter(r=>handedOf(r.host.id)).length
              return <div key={code} className={styles.hostGroup}>
                <div className={styles.countryGroup}>
                  <Check label={code || words.countriesNone} disabled={readOnly || wideLocked || !usable.length} checked={!!usable.length && count===usable.length} indeterminate={count>0 && count<usable.length} onChange={on=>setGroup(usable,on)}/>
                  <button type="button" aria-expanded={isOpen(code)} onClick={()=>setExpanded({...expanded,[code]:!isOpen(code)})}>
                    <Flag code={code || null}/>{code?countryName.of(code):words.countriesNone}<small>{words.hostCount(count,usable.length)}</small><Icon name={isOpen(code)?'chevronUp':'chevronDown'}/>
                  </button>
                </div>
                {isOpen(code) && <ul className={styles.rows}>{group.map(({host,profile,binding})=>(
                  <li key={host.id} className={styles.hostItem}><div className={styles.hostRow}>
                    <Check label={host.remark} checked={handedOf(host.id)} disabled={readOnly || wideLocked || (!host.enabled && !handedOf(host.id))} onChange={on=>toggle(host.id,on)}/>
                    <span className={styles.hostName}>{host.remark}</span><span className={styles.muted}>{profile?.name ?? '-'}</span><span className={styles.port}>{host.portOverride ?? binding?.publicPort ?? binding?.port ?? '-'}</span>
                    {!host.enabled && <small className={styles.muted}>{words.hostOff}</small>}
                    </div>{host.enabled && handedOf(host.id) && profile && userScopeGap(profile) && <small className={styles.protocolNote}>{userScopeGap(profile)==='shared-secret'?words.sharedSecret:words.scopeGap}</small>}
                  </li>))}</ul>}
              </div>
            })}
            {!readOnly && (hostRows.some(entryOf) || hostRows.some(r=>r.host.hiddenByCascade)) && <p className={styles.footNote}>
              {hostRows.some(entryOf) && words.entryCount(hostRows.filter(entryOf).length)}{' '}
              {hostRows.some(r=>r.host.hiddenByCascade) && words.hiddenCount(hostRows.filter(r=>r.host.hiddenByCascade).length)}
            </p>}
          </section>
          <CascadesBlock handedCount={chosenCascades?.length} squadId={squad?.id ?? null} draft={draft} patch={patch} readOnly={readOnly} lockedHosts={wideLocked} squads={squads} />
          <section className={styles.panel+" "+styles.rowsPanel}>
            <header className={styles.rowsHeader + (readOnly ? " "+styles.systemPolicies : "")}><div className={styles.blockHead}><h2 className={styles.panelTitle}>{words.blockPolicies}</h2>{policies.data && <small>{readOnly ? words.rightPoliciesNone : words.hostCount(draft.policyIds.length,policies.data.policies.length)}</small>}</div>
            <p className={styles.note}>{readOnly ? words.allPolicies : words.policyHelp}</p></header>
            {policies.isError && (
              <QueryFailedLine retryLabel={words.retry} onRetry={() => void policies.refetch()}>
                {words.policiesFailed}
              </QueryFailedLine>
            )}
            {!readOnly && policies.data?.policies.length === 0 && <p className={styles.note}>{words.policiesNone}</p>}
            <ul className={styles.rows}>
              {!readOnly && policies.data?.policies.map((policy) => (
                <li key={policy.id} className={styles.hostRow}>
                  <Check label={policy.name} disabled={readOnly} checked={draft.policyIds.includes(policy.id)} onChange={(on) => patch({ policyIds: on ? [...draft.policyIds, policy.id] : draft.policyIds.filter((p) => p !== policy.id) })} />
                  <span className={styles.hostName}>{policy.name}</span>
                  {!!policy.blockDomains?.length && <small>{words.blockedDomains} {fmtNumber(policy.blockDomains.length,locale)}</small>}
                  {!!policy.directDomains?.length && <small>{words.directDomains} {fmtNumber(policy.directDomains.length,locale)}</small>}
                </li>
              ))}
            </ul>
          </section>
          {refusal && <Banner tone="danger">{refusal}</Banner>}
          {squad && !readOnly && <section className={styles.panel + " " + styles.deleteSection}><div><h2 className={styles.panelTitle}>{words.delete}</h2>
            <p className={styles.note}>{words.deleteHint}</p></div><div><Button size="md" variant="danger" onClick={()=>setAsking(true)}>{words.delete}</Button></div>
          </section>}
        </div>
        <aside className={styles.right}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.rightTitle}</h2>
            <dl className={styles.facts}>
              <dt>{words.rightUsers}</dt>
              <dd>{squad ? fmtNumber(squad.memberCount, locale) : 0}</dd>
              <dt>{words.rightHosts}</dt>
              <dd>{hostCount}</dd>
              <dt>{words.rightCascades}</dt>
              <dd>{chosenCascades ? chosenCascades.map(c=>c.name).join(', ') || words.rightPoliciesNone : words.hostsUnknown}</dd>
              <dt>{words.col.profiles}</dt><dd>{profileLabels.join(', ') || words.rightPoliciesNone}</dd>
              <dt>{words.rightPolicies}</dt>
              <dd>{draft.policyIds.map(id => policies.data?.policies.find(p => p.id===id)?.name ?? id).join(', ') || words.rightPoliciesNone}</dd>
              <dt>{words.rightLimit}</dt>
              <dd>{draft.deviceLimit || words.rightLimitNone}</dd>
            </dl>
            <p className={styles.note}>{squad ? words.rightHint : words.addUsersNote}</p>
          </section>
        </aside>
      </div>
      {ask && (
        <Confirm
          title={ask.kind === 'empty' || ask.kind === 'createEmpty' ? words.emptyAskTitle : ask.kind === 'narrow' ? words.narrowAskTitle : words.droppedAskTitle}
          labels={{ confirm: ask.kind === 'createEmpty' ? words.createAnyway : words.saveAnyway, cancel: words.cancel }}
          tone="warn"
          onClose={() => setAsks([])}
          onConfirm={() => {
            if (asks.length > 1) setAsks(asks.slice(1))
            else send()
          }}
        >
          {ask.kind === 'empty' ? words.emptyAskBody : ask.kind === 'createEmpty' ? words.createEmptyAskBody : ask.kind === 'narrow' ? words.narrowAskBody(ask.users, ask.squads) : words.droppedAskBody(ask.names)}
        </Confirm>
      )}
      {asking && squad && (
        <Confirm
          title={words.deleteTitle(squad.name)}
          labels={{ confirm: words.delete, cancel: words.cancel }}
          state={{ busy: remove.isPending, error: remove.error ? failureText(remove.error, locale) : null }}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            remove.mutate(squad.id, {
              onSuccess: () => {
                toast.show(words.deleted(squad.name))
                void navigate('/squads')
              },
            })
          }
        >
          {words.deleteBody(fmtNumber(squad.memberCount, locale))}
        </Confirm>
      )}
    </div>
  )
}

export default function SquadFormPage() {
  const { id } = useParams()
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const squads = useOldSquads()
  const hosts = useHostsAll()
  const bindings = useBindingsAll()
  if (squads.isPending || hosts.isPending || bindings.isPending) return <QueryLoading label={words.loading} />
  if (squads.isError) return <QueryFailed title={words.failedTitle} body={failureText(squads.error, locale)} retryLabel={words.retry} onRetry={() => void squads.refetch()} />
  // Hosts and bindings decide what a save sends. Without them the form must not be open.
  if (hosts.isError || bindings.isError) {
    return (
      <QueryFailed
        title={words.hostsFailed}
        body={failureText(hosts.error ?? bindings.error, locale)}
        retryLabel={words.retry}
        onRetry={() => {
          void hosts.refetch()
          void bindings.refetch()
        }}
      />
    )
  }
  const profileOf = new Map(bindings.data.bindings.map((b) => [b.id, b.profileId]))
  const hostRefs: HostRef[] = hosts.data.hosts.flatMap((h) => {
    const profileId = profileOf.get(h.bindingId)
    return profileId ? [{ id: h.id, profileId }] : []
  })
  if (!id) return <SquadForm squad={null} squads={squads.data.squads} hostRefs={hostRefs} />
  const squad = squads.data.squads.find((s) => s.id === id)
  if (!squad) return <QueryFailed title={words.goneTitle} body={words.goneBody} retryLabel={words.backToList} onRetry={() => void navigate('/squads')} />
  return <SquadForm key={squad.id} squad={squad} squads={squads.data.squads} hostRefs={hostRefs} />
}
