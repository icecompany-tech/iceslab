import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import type { StatusFilter, ListState } from '@/contours/users/hooks/useListState'
import type { ColumnFilter, FilterParam } from '@/contours/users/lib/columns'
import type { NodeRow } from '@/lib/domain/nodes'
import { useDict } from '@/lib/i18n'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { Select } from '@/ui/Select/Select'

const GiB = 1024 ** 3

/** An ISO date field of the request from the native date input, the whole day in local time. */
const dayStart = (date: string) => (date ? new Date(`${date}T00:00:00`).toISOString() : '')
const dayEnd = (date: string) => (date ? new Date(`${date}T23:59:59`).toISOString() : '')
const dateOf = (iso: string | undefined) => {
  if (!iso) return ''
  const at = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

function Opener({ label, active, ...props }: { label: string; active: boolean; 'aria-expanded': boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.filterOpener} ${active ? styles.filterActive : ''}`} {...props}>
      <span className={styles.filterOpenerText}>{label}</span>
      <Icon name={props['aria-expanded'] ? 'chevronUp' : 'chevronDown'} size="sm" />
    </button>
  )
}

/** Status and Limit pick one value, through ui/Popover like «Нода», not a native select (DSGN, head of the users table). */
function Choice({ label, value, options, onPick }: { label: string; value: string; options: readonly { value: string; label: string }[]; onPick: (value: string) => void }) {
  const shown = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? ''
  return (
    <Popover trigger={(props) => <Opener label={shown} active={value !== (options[0]?.value ?? '')} {...props} aria-label={label} />}>
      {(close) => (
        <div role="menu" aria-label={label} className={styles.choiceList}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={styles.choiceItem}
              onClick={() => {
                close()
                onPick(o.value)
              }}
            >
              {o.label}
              {o.value === value && <Icon name="check" size="md" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

function Dates({ list, after, before, presence, label }: { list: ListState; after: FilterParam; before: FilterParam; presence?: FilterParam; label: string }) {
  const words = useDict(DICT)
  const active = [after, before, presence].some((k) => k && list.filters[k])
  return (
    <Popover trigger={(props) => <Opener label={words.filterDates} active={active} {...props} aria-label={label} />}>
      <div className={styles.filterPanel}>
        {presence && (
          <Field label={words.hasExpiry}>
            {(a11y) => <Select {...a11y} value={list.filters[presence] ?? ''} onChange={(e) => list.setFilter(presence, e.target.value)} options={[{ value: '', label: words.any }, { value: 'yes', label: words.choice.yes ?? '' }, { value: 'no', label: words.choice.no ?? '' }]} />}
          </Field>
        )}
        <Field label={words.fromDate}>{(a11y) => <Input {...a11y} type="date" value={dateOf(list.filters[after])} onChange={(e) => list.setFilter(after, dayStart(e.target.value))} />}</Field>
        <Field label={words.toDate}>{(a11y) => <Input {...a11y} type="date" value={dateOf(list.filters[before])} onChange={(e) => list.setFilter(before, dayEnd(e.target.value))} />}</Field>
      </div>
    </Popover>
  )
}

function Bytes({ list, over, under, label }: { list: ListState; over: FilterParam; under: FilterParam; label: string }) {
  const words = useDict(DICT)
  const gb = (key: FilterParam) => {
    const value = list.filters[key]
    return value ? String(Number(value) / GiB) : ''
  }
  const set = (key: FilterParam, text: string) => {
    const n = Number(text.replace(',', '.'))
    list.setFilter(key, text.trim() !== '' && Number.isFinite(n) && n >= 0 ? String(Math.round(n * GiB)) : '')
  }
  return (
    <Popover trigger={(props) => <Opener label={words.filterBytes} active={Boolean(list.filters[over] ?? list.filters[under])} {...props} aria-label={label} />}>
      <div className={styles.filterPanel}>
        <Field label={words.fromGb}>{(a11y) => <Input {...a11y} inputMode="decimal" value={gb(over)} onChange={(e) => set(over, e.target.value)} />}</Field>
        <Field label={words.toGb}>{(a11y) => <Input {...a11y} inputMode="decimal" value={gb(under)} onChange={(e) => set(under, e.target.value)} />}</Field>
      </div>
    </Popover>
  )
}

function NodeFilter({ list, nodes, label }: { list: ListState; nodes: readonly NodeRow[]; label: string }) {
  const words = useDict(DICT)
  return (
    <Popover trigger={(props) => <Opener label={words.filterNode} active={Boolean(list.filters.nodeId ?? list.filters.online)} {...props} aria-label={label} />}>
      <div className={styles.filterPanel}>
        <Field label={words.node}>
          {(a11y) => <Select {...a11y} value={list.filters.nodeId ?? ''} onChange={(e) => list.setFilter('nodeId', e.target.value)} options={[{ value: '', label: words.any }, { value: 'none', label: words.neverConnected }, ...nodes.map((n) => ({ value: n.id, label: n.name }))]} />}
        </Field>
        <Field label={words.online}>
          {(a11y) => <Select {...a11y} value={list.filters.online ?? ''} onChange={(e) => list.setFilter('online', e.target.value)} options={[{ value: '', label: words.any }, ...Object.entries(words.onlineStates).map(([value, text]) => ({ value, label: text }))]} />}
        </Field>
      </div>
    </Popover>
  )
}

export function ColumnFilterCell({ filter, list, nodes, label }: { filter: ColumnFilter | undefined; list: ListState; nodes: readonly NodeRow[]; label: string }) {
  const words = useDict(DICT)
  switch (filter?.kind) {
    case undefined:
      return null
    case 'search':
      return <input className={styles.searchInput} aria-label={words.searchLabel} placeholder={words.searchPlaceholder} value={list.searchText} onChange={(e) => list.setSearchText(e.target.value)} />
    case 'status':
      return (
        <Choice
          label={words.statusFilter}
          value={list.status}
          onPick={(value) => list.setStatus(value as StatusFilter)}
          options={[
            { value: 'all', label: words.anyValue },
            { value: 'active', label: words.statuses.active },
            { value: 'expired', label: words.statuses.expired },
            { value: 'limited', label: words.statuses.limited },
            { value: 'disabled', label: words.statuses.disabled },
          ]}
        />
      )
    case 'node':
      return <NodeFilter list={list} nodes={nodes} label={label} />
    case 'choice': {
      const values = filter.param === 'deviceLimit' ? words.deviceChoice : words.choice
      return (
        <Choice
          label={label}
          value={list.filters[filter.param] ?? ''}
          onPick={(value) => list.setFilter(filter.param, value)}
          options={[{ value: '', label: words.anyValue }, ...filter.values.map((value) => ({ value, label: values[value] ?? value }))]}
        />
      )
    }
    case 'dates':
      return <Dates list={list} after={filter.after} before={filter.before} presence={filter.presence} label={label} />
    case 'bytes':
      return <Bytes list={list} over={filter.over} under={filter.under} label={label} />
  }
}

