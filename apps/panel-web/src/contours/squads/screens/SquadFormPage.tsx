import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CascadesBlock } from '@/contours/squads/components/CascadesBlock'
import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { fetchMembers, useBindingsAll, useCreateSquad, useDeleteSquad, useFleet, useHostsAll, useOldSquads, usePresetsAll, useProfilesAll, useRoutePoliciesAll, useUpdateSquad } from '@/contours/squads/hooks/useSquadsData'
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
      return { host, node: binding ? nodeById.get(binding.nodeId) : undefined, profile: binding ? profileById.get(binding.profileId) : undefined }
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
  const handedOf = (id: string) => draft.picked.includes(id)
  const hostCount = wideLocked ? words.hostsAll(draft.picked.length) : words.hostCount(draft.picked.length, hostRows.length)
  const isPending = create.isPending || update.isPending || checking

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{squad ? squad.name : words.newSquad}</h1>
      {readOnly && <Banner tone="info" title={words.allTitle}>{words.allBody}</Banner>}
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.blockMain}</h2>
            <Field label={words.name} error={!readOnly && nameBad && draft.name !== '' ? words.nameRule : undefined} hint={squad ? undefined : words.nameRule}>{(a11y) => <Input {...a11y} readOnly={readOnly} autoFocus={!squad} value={draft.name} onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })} />}</Field>
            <Field label={words.description}>{(a11y) => <Input {...a11y} readOnly={readOnly} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
            <div className={styles.twoFields}>
              <Field label={words.preset} hint={words.presetHint}>{(a11y) => <Select {...a11y} disabled={readOnly} value={draft.preset} onChange={(e) => patch({ preset: e.target.value })} options={presetRows} />}</Field>
              <Field label={words.deviceLimit} hint={words.deviceLimitHint} error={deviceBad ? words.deviceLimitBad : undefined}>{(a11y) => <Input {...a11y} readOnly={readOnly} inputMode="numeric" value={draft.deviceLimit} onChange={(e) => patch({ deviceLimit: e.target.value })} />}</Field>
            </div>
            {!squad && <p className={styles.note}>{words.addUsersNote}</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.blockHead}>
              <h2 className={styles.panelTitle}>{words.blockHosts}</h2>
              <span className={styles.muted}>{hostCount}</span>
            </div>
            <p className={styles.note}>{words.blockHostsBody}</p>
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
                {words.wideBody(initial.picked.length)}
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
            <ul className={styles.rows}>
              {hostRows.map(({ host, node, profile }) => (
                <li key={host.id} className={host.enabled ? styles.hostRow : `${styles.hostRow} ${styles.hostOff}`}>
                  <Check label={host.remark} checked={handedOf(host.id)} disabled={readOnly || wideLocked} onChange={(on) => toggle(host.id, on)} />
                  <Flag code={node?.countryCode ?? null} />
                  <span className={styles.hostName}>{host.remark}</span>
                  <span className={styles.muted}>
                    {profile?.name ?? '-'} · {node?.name ?? '-'}
                  </span>
                  {!host.enabled && <span className={styles.muted}>{words.hostOff}</span>}
                  {host.hiddenByCascade && <span className={styles.muted}>{words.hostHidden(host.hiddenByCascade.cascadeName)}</span>}
                  {handedOf(host.id) && (profile?.protocol === 'mieru' || profile?.protocol === 'mtproto') && <span className={styles.amber}>{words.scopeGap}</span>}
                </li>
              ))}
            </ul>
          </section>
          <CascadesBlock squadId={squad?.id ?? null} draft={draft} patch={patch} readOnly={readOnly} squads={squads} />
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.blockPolicies}</h2>
            {policies.isError && (
              <QueryFailedLine retryLabel={words.retry} onRetry={() => void policies.refetch()}>
                {words.policiesFailed}
              </QueryFailedLine>
            )}
            {policies.data?.policies.length === 0 && <p className={styles.note}>{words.policiesNone}</p>}
            <ul className={styles.rows}>
              {policies.data?.policies.map((policy) => (
                <li key={policy.id} className={styles.hostRow}>
                  <Check label={policy.name} disabled={readOnly} checked={draft.policyIds.includes(policy.id)} onChange={(on) => patch({ policyIds: on ? [...draft.policyIds, policy.id] : draft.policyIds.filter((p) => p !== policy.id) })} />
                  <span className={styles.hostName}>{policy.name}</span>
                </li>
              ))}
            </ul>
          </section>
          {refusal && <Banner tone="danger">{refusal}</Banner>}
          {!readOnly && (
            <div className={styles.actions}>
              {squad && (
                <Button variant="danger" onClick={() => setAsking(true)}>
                  {words.delete}
                </Button>
              )}
              <span className={styles.spacer} />
              <Button onClick={() => void navigate('/squads')}>{words.cancel}</Button>
              <Button variant="primary" disabled={!changed || nameBad || deviceBad} loading={isPending} onClick={() => void submit()}>
                {squad ? words.save : words.create}
              </Button>
            </div>
          )}
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
              <dd>{draft.exitAcl.length === 0 ? words.cascadesAll : draft.exitAcl.length}</dd>
              <dt>{words.rightPolicies}</dt>
              <dd>{draft.policyIds.length || words.rightPoliciesNone}</dd>
              <dt>{words.rightLimit}</dt>
              <dd>{draft.deviceLimit || words.rightLimitNone}</dd>
            </dl>
            <p className={styles.note}>{words.rightHint}</p>
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
