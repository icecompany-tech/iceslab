import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { useBindingsAll, useCascadesAll, useFleet, useHostsAll, useNodePoliciesAll, useRoutePoliciesAll } from '@/contours/squads/hooks/useSquadsData'
import type { SquadDraft } from '@/contours/squads/lib/squadBody'
import { setCascadeOn, squadCascades, toggleCascadeExit, type NodePolicyRules, type SquadCascade } from '@/contours/squads/lib/squadCascades'
import { useDict } from '@/lib/i18n'
import type { Squad } from '@/lib/old/squads'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'

interface BlockProps {
  squadId: string | null
  draft: SquadDraft
  patch: (next: Partial<SquadDraft>) => void
  readOnly: boolean
  squads: readonly Squad[]
}

export function CascadesBlock({ squadId, draft, patch, readOnly, squads }: BlockProps) {
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
  const whyNot = (row: SquadCascade) => {
    switch (row.notHandedOut) {
      case null:
        return null
      case 'no-granted-host':
        return words.cascadeNoHost
      case 'host-not-picked':
        return words.cascadeNotPicked
      case 'no-entry':
        return words.cascadeNoEntry
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.blockCascades}</h2>
      {cascades.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void cascades.refetch()}>
          {words.cascadesFailed}
        </QueryFailedLine>
      )}
      {cascades.data?.cascades.length === 0 && <p className={styles.note}>{words.cascadesNone}</p>}
      <ul className={styles.rows}>
        {rows.map((row) => {
          const allIds = [...new Set(row.exits.flatMap((e) => e.aclIds))]
          const allowed = row.exits.filter((e) => e.allowed).length
          const summary = row.off ? words.cascadeOff : row.exitsNarrowed ? words.cascadeExitsSome(allowed, row.exits.length) : words.cascadeExitsAll
          return (
            <li key={row.id} className={styles.cascade}>
              <div className={styles.hostRow}>
                <Check label={row.name} disabled={readOnly} checked={!row.off} onChange={(on) => patch({ exitAcl: setCascadeOn([...draft.exitAcl], row.id, on, row.aclField, allIds).acl })} />
                <span className={styles.hostName}>{row.name}</span>
                <span className={styles.muted}>{summary}</span>
                {whyNot(row) && <span className={styles.amber}>{whyNot(row)}</span>}
                {row.entryHostToAdd && !readOnly && <Button onClick={() => row.entryHostToAdd && patch({ hostsTouched: true, picked: [...draft.picked, row.entryHostToAdd] })}>{words.giveEntry}</Button>}
              </div>
              {!row.off && row.exits.length > 1 && (
                <ul className={styles.exits}>
                  {row.exits.map((exit) => (
                    <li key={exit.key} className={styles.hostRow}>
                      <Check
                        label={words.exitTag(exit.countryCode, exit.nodeNames.join(', '))}
                        disabled={readOnly}
                        checked={exit.allowed}
                        onChange={() => {
                          const next = toggleCascadeExit([...draft.exitAcl], row.id, row.aclField, row.exits, exit)
                          if (next) patch({ exitAcl: next })
                        }}
                      />
                      <span>{words.exitTag(exit.countryCode, exit.nodeNames.join(', '))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {noteOf(row) && <p className={styles.amber}>{noteOf(row)}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
