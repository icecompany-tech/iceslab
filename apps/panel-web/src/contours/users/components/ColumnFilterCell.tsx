import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import type { StatusFilter, ListState } from '@/contours/users/hooks/useListState'
import type { ColumnFilter, FilterParam } from '@/contours/users/lib/columns'
import type { NodeRow } from '@/lib/domain/nodes'
import { useDict, useLocale } from '@/lib/i18n'
import { LazyDateTimeField } from '@/ui/DateTimeField/LazyDateTimeField'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { Select } from '@/ui/Select/Select'

const GiB = 1024 ** 3

/** The browser's own clock, as the user window uses it. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const DAY_LAST_MS = 86_399_000

/** «По дату» takes the whole day: the field hands its start, the request gets 23:59:59 of it. */
const dayEnd = (dayStartIso: string) => new Date(Date.parse(dayStartIso) + DAY_LAST_MS).toISOString()

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
    <Popover look="field" trigger={(props) => <Opener label={shown} active={value !== (options[0]?.value ?? '')} {...props} aria-label={label} />}>
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

/** A 32 field inside a filter box that picks one value from its own popover (Paper «Есть срок»). */
function FieldChoice({ label, value, options, onPick }: { label: string; value: string; options: readonly { value: string; label: string }[]; onPick: (value: string) => void }) {
  const shown = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? ''
  return (
    <div className={styles.boxField}>
      <span className={styles.boxLabel}>{label}</span>
      <Popover
        trigger={(props) => (
          <button type="button" className={styles.boxPick} aria-label={label} {...props}>
            {shown}
            <Icon name={props['aria-expanded'] ? 'chevronUp' : 'chevronDown'} size="md" />
          </button>
        )}
      >
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
    </div>
  )
}

function Dates({ list, after, before, presence, label }: { list: ListState; after: FilterParam; before: FilterParam; presence?: FilterParam; label: string }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const active = [after, before, presence].some((k) => k && list.filters[k])
  const texts = { open: words.calendarOpen, previousMonth: words.calendarPrev, nextMonth: words.calendarNext }
  return (
    <Popover look="field" trigger={(props) => <Opener label={words.filterDates} active={active} {...props} aria-label={label} />}>
      <div className={styles.filterPanel}>
        {presence && (
          <FieldChoice
            label={words.hasExpiry}
            value={list.filters[presence] ?? ''}
            onPick={(value) => list.setFilter(presence, value)}
            options={[
              { value: '', label: words.any },
              { value: 'yes', label: words.choice.yes ?? '' },
              { value: 'no', label: words.choice.no ?? '' },
            ]}
          />
        )}
        <LazyDateTimeField kind="day" label={words.fromDate} locale={locale} timeZone={TIME_ZONE} texts={texts} value={list.filters[after] ?? null} onChange={(iso) => list.setFilter(after, iso ?? '')} />
        <LazyDateTimeField kind="day" label={words.toDate} locale={locale} timeZone={TIME_ZONE} texts={texts} value={list.filters[before] ?? null} onChange={(iso) => list.setFilter(before, iso ? dayEnd(iso) : '')} />
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
    <Popover look="field" trigger={(props) => <Opener label={words.filterBytes} active={Boolean(list.filters[over] ?? list.filters[under])} {...props} aria-label={label} />}>
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
    <Popover look="field" trigger={(props) => <Opener label={words.filterNode} active={Boolean(list.filters.nodeId ?? list.filters.online)} {...props} aria-label={label} />}>
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

