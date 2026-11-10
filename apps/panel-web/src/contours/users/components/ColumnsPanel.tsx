import { useState } from 'react'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { COLUMN_BY_ID, DEFAULT_VIEW, type ColumnId, type ColumnPin, type ColumnView } from '@/contours/users/lib/columns'
import { useDict } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { Switch } from '@/ui/Switch/Switch'

export function ColumnsPanel({ view, onChange }: { view: ColumnView; onChange: (next: ColumnView) => void }) {
  const words = useDict(DICT)
  const [dragged, setDragged] = useState<ColumnId | null>(null)
  const total = view.order.length
  const shown = total - view.hidden.length
  const pin = (id: ColumnId, side: ColumnPin) => {
    const pins = { ...view.pins }
    if (pins[id] === side) delete pins[id]
    else pins[id] = side
    onChange({ ...view, pins })
  }
  const dropOn = (target: ColumnId) => {
    if (!dragged || dragged === target) return
    const order = view.order.filter((id) => id !== dragged)
    order.splice(order.indexOf(target), 0, dragged)
    onChange({ ...view, order })
  }
  return (
    <div className={styles.columnsPanel}>
      <div className={styles.columnsHead}>
        <span className={styles.columnsLinks}>
        <button type="button" className={styles.textButton} onClick={() => onChange({ ...view, hidden: view.order.filter((id) => id !== 'username') })}>
          {words.hideAll}
        </button>
        <button type="button" className={styles.textButton} onClick={() => onChange({ ...view, order: DEFAULT_VIEW.order })}>
          {words.resetOrder}
        </button>
        <button type="button" className={styles.textButton} onClick={() => onChange({ ...view, pins: {} })}>
          {words.unpin}
        </button>
        <button type="button" className={styles.textButton} onClick={() => onChange({ ...view, hidden: [] })}>
          {words.showAll}
        </button>
        </span>
        <span className={styles.columnsCount}>
          {shown}/{total}
        </span>
      </div>
      <ul className={styles.columnsList}>
        {view.order.map((id) => {
          const name = words.column[id]
          if (!COLUMN_BY_ID.has(id)) return null
          return (
            <li key={id} className={styles.columnsRow} draggable onDragStart={() => setDragged(id)} onDragEnd={() => setDragged(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(id)}>
              <span className={styles.grip} title={words.moveColumn(name)}>
                <Icon name="grip" size="md" />
              </span>
              <button type="button" className={`${styles.pinButton} ${view.pins[id] === 'left' ? styles.pinOn : ''}`} aria-label={words.pinLeft(name)} aria-pressed={view.pins[id] === 'left'} onClick={() => pin(id, 'left')}>
                <Icon name="pinLeft" size="md" />
              </button>
              <button type="button" className={`${styles.pinButton} ${view.pins[id] === 'right' ? styles.pinOn : ''}`} aria-label={words.pinRight(name)} aria-pressed={view.pins[id] === 'right'} onClick={() => pin(id, 'right')}>
                <Icon name="pinRight" size="md" />
              </button>
              {/* Paper ui/ColumnsPanel: the switch, then the name, bright while the column shows. */}
              <span className={`${styles.columnsSwitch} ${view.hidden.includes(id) ? '' : styles.columnsShown}`}>
                <Switch
                  label={name}
                  checked={!view.hidden.includes(id)}
                  disabled={id === 'username'}
                  onChange={(on) => onChange({ ...view, hidden: on ? view.hidden.filter((h) => h !== id) : [...view.hidden, id] })}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
