// Bk-170: the TCP options of an xray inbound, and what each node carrying the profile will do with
// them. The agent says it per core (rendersSockopt); an agent that predates the field says nothing,
// and that is «unknown», never «does not apply». Fields as Paper draws them: «Профили», «Форма,
// настройка / Дополнительно xray, таймауты TCP» (1440). The nodes block waits for DSGN's table.
import { useId } from 'react'
import styles from '@/contours/profiles/components/profiles.module.css'
import { DICT } from '@/contours/profiles/dict'
import { useAllBindings, useFleetNames } from '@/contours/profiles/hooks/useProfiles'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { SOCKOPT_FIELDS, sockoptReach, type SockoptField, type SockoptReach } from '@/contours/profiles/lib/xraySockopt'
import { useDict } from '@/lib/i18n'
import type { Node } from '@/lib/old/nodes'

const xrayReach = (node: Node | undefined): SockoptReach => sockoptReach(node?.cores?.cores.find((c) => c.engine === 'xray' || c.name === 'xray')?.rendersSockopt)

function NodesReach({ profileId }: { profileId: string | null }) {
  const words = useDict(DICT)
  const bindings = useAllBindings()
  const fleet = useFleetNames()
  const nodeIds = [...new Set((bindings.data?.bindings ?? []).filter((b) => profileId !== null && b.profileId === profileId).map((b) => b.nodeId))]
  if (profileId === null || (bindings.data && nodeIds.length === 0)) return <p className={styles.note}>{words.tcpNoNodes}</p>
  if (bindings.isError || fleet.isError) return <p className={styles.note}>{words.tcpNodesFailed}</p>
  if (!bindings.data || !fleet.data) return null
  const rows = nodeIds.map((id) => {
    const node = fleet.data.nodes.find((n) => n.id === id)
    return { id, name: node?.name ?? id.slice(0, 8), reach: xrayReach(node) }
  })
  return (
    <>
      <ul className={styles.sockoptNodes} aria-label={words.tcpNodesLabel}>
        {rows.map(({ id, name, reach }) => (
          <li key={id} className={reach === 'applies' ? '' : reach === 'refuses' ? styles.sockoptRefuses : styles.sockoptUnknown}>
            <b>{name}</b>: {words.tcpReach[reach]}
          </li>
        ))}
      </ul>
      {/* Paper b9/profiles.md «Подсказка «не знаю»»: only when some node did not say. */}
      {rows.some((r) => r.reach === 'unknown') && <p className={styles.unitHint}>{words.tcpUnknownHint}</p>}
    </>
  )
}

/** One row of the frame: the label on the left, the field with its unit inside on the right. */
function UnitRow({ label, unit, value, error, onChange }: { label: string; unit: string; value: string; error: string | undefined; onChange: (text: string) => void }) {
  const id = useId()
  const words = useDict(DICT)
  return (
    <div className={styles.unitRow}>
      <label className={styles.unitLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.unitCell}>
        <span className={`${styles.unitField} ${error ? styles.unitInvalid : ''}`}>
          <input id={id} className={styles.unitInput} inputMode="numeric" placeholder={words.tcpAsCore} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        </span>
        {error && (
          <span id={`${id}-error`} className={styles.unitError}>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

export function SockoptFields({ values, patch, profileId, problem }: { values: FormValues; patch: (next: Partial<FormValues>) => void; profileId: string | null; problem: SockoptField | undefined }) {
  const words = useDict(DICT)
  const labels: Record<SockoptField, string> = { xrayTcpUserTimeout: words.tcpUserTimeout, xrayTcpKeepAliveIdle: words.tcpKeepAliveIdle, xrayTcpKeepAliveInterval: words.tcpKeepAliveInterval }
  return (
    <div className={styles.unitRows}>
      {SOCKOPT_FIELDS.map(({ field, max, unit }) => (
        <UnitRow key={field} label={labels[field]} unit={words.unit[unit]} value={values[field]} error={problem === field ? words.tcpRange(max) : undefined} onChange={(text) => patch({ [field]: text })} />
      ))}
      <p className={styles.unitHint}>{words.tcpEmpty}</p>
      <NodesReach profileId={profileId} />
    </div>
  )
}
