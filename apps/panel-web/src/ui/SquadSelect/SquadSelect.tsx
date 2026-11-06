import { useState, type Key } from 'react'
import {
  Autocomplete,
  Button,
  Header,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  SearchField,
  Select,
  SelectValue,
  Tag,
  TagGroup,
  TagList,
  useFilter,
} from 'react-aria-components'
import { Icon } from '@/ui/Icon/Icon'
import styles from '@/ui/SquadSelect/SquadSelect.module.css'

// The frame ui/SquadSelect/много: three tags, the rest as +N.
const VISIBLE_TAGS = 3

export interface SquadOption {
  id: string
  name: string
  hint?: string
}

export interface SquadSelectTexts {
  placeholder: string
  search: string
  empty: string
  allGroup: string
  clearAll: string
  clearSearch: string
  /** React Aria adds the tag's own name after it: "Убрать basic". */
  remove: string
  selectedGroup: (count: number) => string
  selectedFooter: (count: number, total: number) => string
  foundFooter: (count: number, total: number) => string
}

export interface SquadSelectProps {
  label: string
  options: readonly SquadOption[]
  value: readonly string[]
  onChange: (next: string[]) => void
  texts: SquadSelectTexts
}

function Marked({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className={styles.match}>{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  )
}

function Row({ option, query }: { option: SquadOption; query: string }) {
  return (
    <ListBoxItem id={option.id} textValue={option.name} className={styles.row}>
      <span className={styles.check} aria-hidden="true">
        <Icon name="check" size="sm" />
      </span>
      <span className={styles.name}>
        <Marked text={option.name} query={query} />
      </span>
      {option.hint && <span className={styles.hint}>{option.hint}</span>}
    </ListBoxItem>
  )
}

export function SquadSelect({ label, options, value, onChange, texts }: SquadSelectProps) {
  const [query, setQuery] = useState('')
  // Rows change group when the list opens, not under the cursor: a row that jumps
  // to "selected" while being clicked would leave the keyboard focus somewhere else.
  const [pinned, setPinned] = useState<readonly string[]>(value)
  const { contains } = useFilter({ sensitivity: 'base' })

  const byId = new Map(options.map((o) => [o.id, o]))
  const chosen = value.flatMap((id) => byId.get(id) ?? [])
  const searching = query !== ''
  const found = searching ? options.filter((o) => contains(o.name, query)).length : 0
  const pinnedSet = new Set(pinned)
  const top = options.filter((o) => pinnedSet.has(o.id))
  const rest = options.filter((o) => !pinnedSet.has(o.id))

  const remove = (keys: Set<Key>) => onChange(value.filter((id) => !keys.has(id)))

  return (
    <div className={styles.root}>
      <Select
        className={styles.select}
        selectionMode="multiple"
        value={[...value]}
        onChange={(next) => onChange(next.map(String))}
        onOpenChange={(open) => {
          if (!open) return
          setPinned(value)
          setQuery('')
        }}
      >
        <Label className={styles.label}>{label}</Label>
        <Button className={styles.trigger}>
          {/* The text, not the row: by default it would read the hint out with the name. */}
          <SelectValue className={styles.hidden}>{({ selectedText }) => selectedText}</SelectValue>
          <span className={styles.chevron}>
            <Icon name="chevronDown" size="md" />
          </span>
        </Button>

        <Popover className={styles.popover} placement="bottom start" offset={6}>
          <Autocomplete inputValue={query} onInputChange={setQuery} filter={contains}>
            <SearchField aria-label={texts.search} className={styles.search} autoFocus>
              <span className={styles.searchIcon}>
                <Icon name="search" />
              </span>
              <Input className={styles.searchInput} placeholder={texts.search} />
              {searching && (
                <Button aria-label={texts.clearSearch} className={styles.searchClear}>
                  <Icon name="close" size="sm" />
                </Button>
              )}
            </SearchField>
            <ListBox
              className={styles.list}
              aria-label={label}
              renderEmptyState={() => <div className={styles.empty}>{texts.empty}</div>}
            >
              {searching ? (
                options.map((o) => <Row key={o.id} option={o} query={query} />)
              ) : (
                <>
                  {top.length > 0 && (
                    <ListBoxSection>
                      <Header className={styles.group}>{texts.selectedGroup(top.length)}</Header>
                      {top.map((o) => (
                        <Row key={o.id} option={o} query="" />
                      ))}
                    </ListBoxSection>
                  )}
                  <ListBoxSection>
                    <Header className={styles.group}>{texts.allGroup}</Header>
                    {rest.map((o) => (
                      <Row key={o.id} option={o} query="" />
                    ))}
                  </ListBoxSection>
                </>
              )}
            </ListBox>
          </Autocomplete>
          <div className={styles.footer}>
            <span>
              {searching
                ? texts.foundFooter(found, options.length)
                : texts.selectedFooter(value.length, options.length)}
            </span>
            {!searching && value.length > 0 && (
              <Button className={styles.clear} onPress={() => onChange([])}>
                {texts.clearAll}
              </Button>
            )}
          </div>
        </Popover>
      </Select>

      {/* Outside <Select> and over its button. Inside, Select's collection builder takes
          every Tag for one of its own items and throws "Duplicate key" on an id that is
          also a ListBoxItem (react-aria-components 1.22.1). A button in a button is not
          valid HTML either, so the tags could not be inside the trigger anyway. */}
      <div className={styles.over}>
        {chosen.length === 0 ? (
          <span className={styles.placeholder}>{texts.placeholder}</span>
        ) : (
          <TagGroup aria-label={label} className={styles.tags} onRemove={remove}>
            <TagList className={styles.tagList}>
              {chosen.slice(0, VISIBLE_TAGS).map((o) => (
                <Tag key={o.id} id={o.id} textValue={o.name} className={styles.tag}>
                  {o.name}
                  <Button slot="remove" aria-label={texts.remove} className={styles.tagRemove}>
                    <Icon name="close" size="sm" />
                  </Button>
                </Tag>
              ))}
            </TagList>
            {chosen.length > VISIBLE_TAGS && (
              <span className={styles.more}>+{chosen.length - VISIBLE_TAGS}</span>
            )}
          </TagGroup>
        )}
      </div>
    </div>
  )
}
