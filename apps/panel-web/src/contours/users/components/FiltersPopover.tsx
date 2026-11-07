import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import type { ListState } from '@/contours/users/hooks/useListState'
import { useUserTags } from '@/contours/users/hooks/useUsers'
import type { FilterParam } from '@/contours/users/lib/columns'
import type { Squad } from '@/lib/domain/squads'
import { useDict } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { Select, type SelectOption } from '@/ui/Select/Select'

const dayIso = (date: string, end: boolean) => (date ? new Date(`${date}T${end ? '23:59:59' : '00:00:00'}`).toISOString() : '')

/** Applied at once. These are the parameters of the columns hidden by default. */
export function FiltersPopover({ list, squads }: { list: ListState; squads: readonly Squad[] }) {
  const words = useDict(DICT)
  const tags = useUserTags()
  const any = { value: '', label: words.any }
  const pick = (label: string, param: FilterParam, options: readonly SelectOption[]) => (
    <Field label={label}>{(a11y) => <Select {...a11y} value={list.filters[param] ?? ''} onChange={(e) => list.setFilter(param, e.target.value)} options={[any, ...options]} />}</Field>
  )
  const yesNo = (values: readonly [string, string]) => values.map((value) => ({ value, label: words.choice[value] ?? value }))
  return (
    <Popover
      align="end"
      trigger={(props) => (
        <Button icon={<Icon name="filter" size="md" />} {...props}>
          {words.filters}
        </Button>
      )}
    >
      <div className={styles.filtersPanel}>
        {pick(words.squad, 'groupId', squads.map((s) => ({ value: s.id, label: s.name })))}
        {pick(words.tag, 'tag', (tags.data ?? []).map((t) => ({ value: t, label: t })))}
        <div className={styles.filtersPair}>
          {pick(words.telegram, 'telegram', yesNo(['linked', 'none']))}
          {pick(words.email, 'email', yesNo(['set', 'none']))}
        </div>
        <div className={styles.filtersPair}>
          {pick(words.deviceLimit, 'deviceLimit', Object.entries(words.deviceChoice).map(([value, label]) => ({ value, label })))}
          {pick(words.linkRevoked, 'revoked', yesNo(['yes', 'no']))}
        </div>
        <div className={styles.filtersPair}>
          <Field label={`${words.created}, ${words.fromDate.toLowerCase()}`}>{(a11y) => <Input {...a11y} type="date" onChange={(e) => list.setFilter('createdAfter', dayIso(e.target.value, false))} />}</Field>
          <Field label={words.toDate}>{(a11y) => <Input {...a11y} type="date" onChange={(e) => list.setFilter('createdBefore', dayIso(e.target.value, true))} />}</Field>
        </div>
      </div>
    </Popover>
  )
}
