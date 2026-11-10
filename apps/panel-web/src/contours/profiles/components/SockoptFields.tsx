// Bk-170: the TCP options of an xray inbound, and what each node carrying the profile will do with
// them. The agent says it per core (rendersSockopt); an agent that predates the field says nothing,
// and that is «unknown», never «does not apply».
import styles from '@/contours/profiles/components/profiles.module.css'
import { DICT } from '@/contours/profiles/dict'
import { useAllBindings, useFleetNames } from '@/contours/profiles/hooks/useProfiles'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { SOCKOPT_FIELDS, sockoptReach, type SockoptField, type SockoptReach } from '@/contours/profiles/lib/xraySockopt'
import { useDict } from '@/lib/i18n'
import type { Node } from '@/lib/old/nodes'
import { Field, Input } from '@/ui/Field/Field'

const xrayReach = (node: Node | undefined): SockoptReach => sockoptReach(node?.cores?.cores.find((c) => c.engine === 'xray' || c.name === 'xray')?.rendersSockopt)

function NodesReach({ profileId }: { profileId: string | null }) {
  const words = useDict(DICT)
  const bindings = useAllBindings()
  const fleet = useFleetNames()
  const nodeIds = [...new Set((bindings.data?.bindings ?? []).filter((b) => profileId !== null && b.profileId === profileId).map((b) => b.nodeId))]
  if (profileId === null || (bindings.data && nodeIds.length === 0)) return <p className={styles.note}>{words.tcpNoNodes}</p>
  if (bindings.isError || fleet.isError) return <p className={styles.note}>{words.tcpNodesFailed}</p>
  if (!bindings.data || !fleet.data) return null
  return (
    <ul className={styles.sockoptNodes} aria-label={words.tcpNodesLabel}>
      {nodeIds.map((id) => {
        const node = fleet.data.nodes.find((n) => n.id === id)
        const reach = xrayReach(node)
        return (
          <li key={id} className={reach === 'applies' ? '' : reach === 'refuses' ? styles.sockoptRefuses : styles.sockoptUnknown}>
            <b>{node?.name ?? id.slice(0, 8)}</b>: {words.tcpReach[reach]}
          </li>
        )
      })}
    </ul>
  )
}

export function SockoptFields({ values, patch, profileId, problem }: { values: FormValues; patch: (next: Partial<FormValues>) => void; profileId: string | null; problem: SockoptField | undefined }) {
  const words = useDict(DICT)
  const labels: Record<SockoptField, string> = { xrayTcpUserTimeout: words.tcpUserTimeout, xrayTcpKeepAliveIdle: words.tcpKeepAliveIdle, xrayTcpKeepAliveInterval: words.tcpKeepAliveInterval }
  return (
    <fieldset className={styles.fieldset}>
      <legend>{words.tcpTimeouts}</legend>
      <div className={`${styles.threeFields} ${styles.fieldsAtBase}`}>
        {SOCKOPT_FIELDS.map(({ field, max }) => (
          <Field key={field} label={labels[field]} error={problem === field ? words.tcpRange(max) : undefined}>
            {(a11y) => (
              <Input
                {...a11y}
                inputMode="numeric"
                placeholder="-"
                value={values[field]}
                onChange={(e) => {
                  const text = e.target.value.trim()
                  patch({ [field]: text === '' || Number.isNaN(Number(text)) ? '' : Number(text) })
                }}
              />
            )}
          </Field>
        ))}
      </div>
      <p className={styles.note}>{words.tcpEmpty}</p>
      <NodesReach profileId={profileId} />
    </fieldset>
  )
}
