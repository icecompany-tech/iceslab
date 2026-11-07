import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { poolRowFacts } from '@/contours/cascades/lib/cascadeForm'
import { useDict } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { Select } from '@/ui/Select/Select'

export interface PoolFieldProps {
  form: CascadeForm
  label: string
  ids: readonly string[]
  onChange: (ids: string[]) => void
}

/**
 * A pool as a column of pickers. A node of this cascade is not offered twice, the server refuses
 * loops; a node of another cascade stays pickable and says whose it is. A deleted node says so:
 * an empty picker in its place would read as «nobody picked».
 */
export function PoolField({ form, label, ids, onChange }: PoolFieldProps) {
  const words = useDict(DICT)
  const rows = ids.length > 0 ? ids : ['']
  const elsewhere = form.othersThan(rows)
  return (
    <div className={styles.pool}>
      <span className={styles.note}>{label}</span>
      {rows.map((id, i) => {
        const facts = poolRowFacts(id, [...form.nodes])
        const taken = new Set([...elsewhere, ...rows.filter((_, j) => j !== i)])
        const options = form.nodes
          .filter((n) => !taken.has(n.id) || n.id === id)
          .map((n) => {
            const owner = form.claimedBy.get(n.id)
            return { value: n.id, label: [n.name, n.status, owner ? words.nodeInCascade(owner) : ''].filter(Boolean).join(' · ') }
          })
        return (
          <div key={`${i}-${id}`} className={styles.poolRow}>
            {facts.state === 'missing' ? (
              <span className={styles.danger}>{words.nodeGone(facts.shortId ?? '')}</span>
            ) : (
              <Select aria-label={words.nodeField} value={id} onChange={(e) => onChange(rows.map((r, j) => (j === i ? e.target.value : r)))} options={[{ value: '', label: words.nodePlaceholder }, ...options]} />
            )}
            {(rows.length > 1 || facts.state === 'missing') && (
              <Button size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                {words.remove}
              </Button>
            )}
          </div>
        )
      })}
      <div>
        <Button size="sm" onClick={() => onChange([...rows, ''])}>
          {words.addNode}
        </Button>
      </div>
    </div>
  )
}
