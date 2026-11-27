import { useState } from 'react'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import type { Cascade } from '@/lib/old/cascades'
import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { useBindingsAll, useCascadesAll, useFleet, useHostsAll, useNodePoliciesAll, useRoutePoliciesAll, useProfilesAll } from '@/contours/squads/hooks/useSquadsData'
import type { SquadDraft } from '@/contours/squads/lib/squadBody'
import { aclIdsOf, isCascadeEntry, setCascadeOn, squadCascades, toggleCascadeExit, type NodePolicyRules, type SquadCascade } from '@/contours/squads/lib/squadCascades'
import { useDict, useLocale } from '@/lib/i18n'
import type { Squad } from '@/lib/old/squads'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'

interface BlockProps {
  handedCount: number | undefined
  squadId: string | null
  draft: SquadDraft
  patch: (next: Partial<SquadDraft>) => void
  lockedHosts: boolean
  readOnly: boolean
  squads: readonly Squad[]
}

export function CascadesBlock({ handedCount, squadId, draft, patch, readOnly, lockedHosts, squads }: BlockProps) {
  const words = useDict(DICT)
  const cascades = useCascadesAll()
  const hosts = useHostsAll()
  const bindings = useBindingsAll()
  const nodes = useFleet()
  const policies = useRoutePoliciesAll()
  const nodePolicies = useNodePoliciesAll()
  const profileIdsOf = (ids: readonly string[]) => {
    const byBinding = new Map((bindings.data?.bindings ?? []).map((b) => [b.id, b.profileId]))
    return [...new Set((hosts.data?.hosts ?? []).filter((h) => ids.includes(h.id)).flatMap((h) => byBinding.get(h.bindingId) ?? []))]
  }
  const rows: SquadCascade[] = squadCascades(
    squadId,
    { profileIds: profileIdsOf(draft.picked), hostIds: [...draft.picked], restricted: true, exitAcl: [...draft.exitAcl], policyIds: [...draft.policyIds] },
    {
      cascades: cascades.data?.cascades ?? [],
      hosts: hosts.data?.hosts ?? [],
      bindings: bindings.data?.bindings ?? [],
      nodes: nodes.data?.nodes ?? [],
      squads: [...squads],
      policies: policies.data?.policies ?? [],
      nodePolicies: (nodePolicies.data?.policies as NodePolicyRules[] | undefined) ?? null,
    },
  )
  const noteOf = (row: SquadCascade) => {
    switch (row.nodePolicyNote) {
      case null:
        return null
      case 'gated':
        return words.noteGated
      case 'gated-except-chain':
        return words.noteGatedChain
      case 'unknown':
        return words.noteUnknown
    }
  }
  const [open, setOpen] = useState<Record<string,boolean>>({})
  const [parked, setParked] = useState<Record<string,string[] | undefined>>({})
  const { locale } = useLocale()
  const regions = new Intl.DisplayNames([locale], {type:'region'})
  const profiles = useProfilesAll()
  const available = cascades.data?.cascades ?? []
  const byBinding = new Map(bindings.data?.bindings.map(b => [b.id,b]))
  const byProfile = new Map(profiles.data?.profiles.map(p => [p.id,p.protocol]))
  function hostsFor(c: Cascade) {
    return (hosts.data?.hosts ?? []).filter(h => {
      const b = byBinding.get(h.bindingId)
      return h.enabled && !h.hiddenByCascade && !h.isHidden && b && isCascadeEntry(c,b.nodeId,byProfile.get(b.profileId) ?? '')
    })
  }
  return <section className={styles.panel+" "+styles.rowsPanel}>
    <header className={styles.rowsHeader}><div className={styles.blockHead}><h2 className={styles.panelTitle}>{words.blockCascades}</h2>{handedCount!==undefined && <small>{words.hostCount(handedCount,rows.length)}</small>}</div>
    <p className={styles.note}>{readOnly ? words.allExits : words.cascadeHelp}</p></header>
    {cascades.isError && <QueryFailedLine retryLabel={words.retry} onRetry={()=>void cascades.refetch()}>{words.cascadesFailed}</QueryFailedLine>}
    {cascades.data && !rows.length && <p className={styles.note}>{words.cascadesNone}</p>}
    <ul className={styles.rows}>{rows.map((row,i)=>{
      const cascade = available.find(c=>c.id===row.id)!
      const entries = hostsFor(cascade)
      const picked = entries.filter(h=>readOnly || draft.picked.includes(h.id))
      const allowed = row.exits.filter(e=>e.allowed)
      const allIds = row.exits.flatMap(e=>e.aclIds)
      const protocol = cascade.positions.find(p=>p.position===0)?.entryProtocol ?? cascade.hops.find(h=>h.position===0)?.entryProtocol
      const canNarrow = protocol !== 'hysteria' && protocol !== 'amneziawg'
      const expanded = open[row.id] ?? (!!squadId && !readOnly && i===0)
      const grantAcl = (on:boolean) => {
        const next = setCascadeOn([...draft.exitAcl],row.id,on,row.aclField,allIds,parked[row.id])
        setParked(current=>({...current,[row.id]:next.parked}))
        return next.acl
      }
      const setGrant = (on:boolean) => {
        const entryIds = new Set(entries.map(h=>h.id))
        const otherEntries = new Set(available.filter(c=>c.enabled && c.id!==row.id && !draft.exitAcl.some(a=>a.cascadeId===c.id && !aclIdsOf(a).length)).flatMap(c=>hostsFor(c).map(h=>h.id)))
        patch({hostsTouched:true, picked:on ? [...new Set([...draft.picked,...entryIds])] : draft.picked.filter(id=>!entryIds.has(id)||otherEntries.has(id)),
          exitAcl:on && !row.off ? draft.exitAcl.filter(a=>a.cascadeId!==row.id) : grantAcl(on)})
      }
      return <li key={row.id} className={styles.cascade}>
        <div className={styles.countryGroup}>
          <Check label={row.name} disabled={readOnly || lockedHosts || !entries.length} checked={!row.off && !!picked.length && allowed.length===row.exits.length} indeterminate={!row.off && !!entries.length && (row.exitsNarrowed || picked.length>0 && picked.length<entries.length)} onChange={setGrant}/>
          <button type="button" className={styles.cascadeToggle} aria-expanded={expanded} onClick={()=>setOpen({...open,[row.id]:!expanded})}>
            <strong>{row.name}</strong>
            <small>{row.entryCountries?.map(c=>regions.of(c)).join(', ')} → {words.exit} ({row.exits.length})</small>
            <small className={!entries.length || !row.off && !picked.length ? styles.amber : undefined}>{!entries.length?words.cascadeNoHost:row.off?words.cascadeOff:!picked.length?words.cascadeNotPicked:row.exitsNarrowed?words.cascadeExitsSome(allowed.length,row.exits.length):words.cascadeExitsAll}</small>
            <Icon name={expanded?'chevronUp':'chevronDown'}/>
          </button>
        </div>
        {!picked.length && entries.length>0 && !readOnly && !lockedHosts && !!squadId && (expanded || !row.off) && <div><Button onClick={()=>patch({hostsTouched:true,picked:[...draft.picked,entries[0]!.id],exitAcl:row.off?grantAcl(true):draft.exitAcl})}>{words.giveEntry}</Button></div>}
        {expanded && <>
          <div className={styles.twoFields}><div><h3>{words.entry}<small>{words.hostCount(picked.length,entries.length)}</small></h3>{entries.map(h=><label className={styles.hostRow} key={h.id}>
            <Check label={h.remark} checked={readOnly || draft.picked.includes(h.id)} disabled={readOnly || lockedHosts} onChange={on=>{
              if(!on && picked.length===1){setGrant(false);return}
              patch({hostsTouched:true,picked:on?[...new Set([...draft.picked,h.id])]:draft.picked.filter(id=>id!==h.id), exitAcl:on && row.off?grantAcl(true):draft.exitAcl})
            }}/><Flag code={nodes.data?.nodes.find(n=>n.id===byBinding.get(h.bindingId)?.nodeId)?.countryCode ?? null}/>{h.remark}
            <small>{profiles.data?.profiles.find(p=>p.id===byBinding.get(h.bindingId)?.profileId)?.name}</small><small>{h.portOverride ?? byBinding.get(h.bindingId)?.publicPort ?? byBinding.get(h.bindingId)?.port}</small></label>)}
            {!entries.length && <small>{words.cascadeNoHost}</small>}
          </div><div><h3>{words.exit}<small>{canNarrow ? words.hostCount(allowed.length,row.exits.length) : words.all}</small></h3>{row.exits.map(exit=>{
            const direction = cascade.directions.find(d=>d.id===exit.key)
            const target = exit.nodeNames.join(', ') || direction?.outboundId
            return <label className={styles.hostRow} key={exit.key}>
            {canNarrow && <Check label={words.exitTag(exit.countryCode,exit.nodeNames.join(', '))} disabled={readOnly || row.off || !target || (lockedHosts && exit.allowed && allowed.length===1)} checked={!row.off && !!target && exit.allowed} onChange={()=>{
              const next=toggleCascadeExit([...draft.exitAcl],row.id,row.aclField,row.exits,exit)
              if(next)patch({exitAcl:next})
              else if(!lockedHosts)setGrant(false)
            }}/>}<Flag code={exit.countryCode}/>{exit.countryCode ? regions.of(exit.countryCode) : '-'} <small>{target || words.noExit}</small></label>})}
            {!canNarrow && <p className={styles.footNote}>{words.chainExits}</p>}
            {canNarrow && cascade.autoProfile && row.exits.length>1 && <p className={styles.autoExit}>{words.auto} · {row.off || row.exitsNarrowed ? words.needsExits : words.cascadeExitsAll}</p>}
          </div></div>
        </>}
        {noteOf(row) && <p className={styles.amber}>{noteOf(row)}</p>}
      </li>
    })}</ul>
  </section>
}
