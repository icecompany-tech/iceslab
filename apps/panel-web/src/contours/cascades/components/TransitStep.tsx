import { useState } from 'react'
import { ChainNotes } from '@/contours/cascades/components/EntryStep'
import { PoolField } from '@/contours/cascades/components/PoolField'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { appendPosition, MAX_LINKS, MAX_POSITIONS, movePosition, removePosition, reorderedPositions } from '@/contours/cascades/lib/cascadeForm'
import { countLinks, nextFreeKey } from '@/contours/cascades/lib/draft'
import { useDict } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { Icon } from '@/ui/Icon/Icon'

/** The entry stays first: a transit moves only among transits. A moved one sends its own leg (A-140). */
export function TransitStep({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { pools, directions } = form.draft
  const [dragged, setDragged] = useState<number | null>(null)
  const full = pools.length + 1 >= MAX_POSITIONS
  const links = countLinks(pools, directions)
  const drop = (target: number) => {
    if (dragged === null || dragged === target || target === 0) return
    const next = [...pools]
    const [moved] = next.splice(dragged, 1)
    if (moved) next.splice(target, 0, moved)
    form.patch({ pools: reorderedPositions(pools, next) })
    setDragged(null)
  }
  return (
    <>
      {pools.length === 1 && <p className={styles.note}>{words.noTransit}</p>}
      {pools.length > 2 && <p className={styles.note}>{words.dragHint}</p>}
      {pools.slice(1).map((pool, offset) => {
        const i = offset + 1
        const ids = pool.nodeIds.filter(Boolean)
        return (
          <div key={pool.key} className={styles.hopRow} draggable onDragStart={() => setDragged(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(i)}>
            <div className={styles.hopHead}>
              <Icon name="grip" size="md" />
              <b>{words.hopTitle(i + 1)}</b>
              {ids.length > 1 && <span className={styles.note}>{words.hopBalancer}</span>}
              <span className={styles.spacer} />
              <Button size="sm" disabled={i <= 1} onClick={() => form.patch({ pools: movePosition(pools, i, -1) })}>
                {words.moveUp}
              </Button>
              <Button size="sm" disabled={i >= pools.length - 1} onClick={() => form.patch({ pools: movePosition(pools, i, 1) })}>
                {words.moveDown}
              </Button>
              <Button size="sm" onClick={() => form.patch({ pools: removePosition(pools, i) })}>
                {words.remove}
              </Button>
            </div>
            <PoolField form={form} label={words.poolTransit} ids={pool.nodeIds} onChange={(next) => form.setPoolNodes(i, next)} />
            <ChainNotes form={form} ids={ids} />
          </div>
        )
      })}
      <div className={styles.addRow}>
        <Button size="sm" disabled={full} onClick={() => form.patch({ pools: appendPosition(pools, nextFreeKey(pools)) })}>
          {words.addHop}
        </Button>
        {full && <span className={styles.note}>{words.addHopFull(MAX_POSITIONS)}</span>}
      </div>
      <p className={links > MAX_LINKS ? styles.danger : styles.note}>{links > MAX_LINKS ? words.tooManyLinks(links, MAX_LINKS) : words.linksCount(links, MAX_LINKS)}</p>
    </>
  )
}
