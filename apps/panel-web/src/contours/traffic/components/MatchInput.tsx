import { useState } from 'react'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useGeoSets, useGeoTags } from '@/contours/traffic/hooks/useRoutes'
import { geoTagQuery, withGeoTag } from '@/contours/traffic/lib/geoTagHint'
import { DICT } from '@/contours/traffic/routesDict'
import { useDict } from '@/lib/i18n'

function TagHint({ line, onPick }: { line: string; onPick: (line: string) => void }) {
  const words = useDict(DICT)
  const { byName } = useGeoSets()
  const query = geoTagQuery(line)
  const set = query ? byName.get(query.setName) : undefined
  const tags = useGeoTags(set?.id, query?.q, Boolean(set?.current))
  if (!query || byName.size === 0) return null
  const note = !set ? words.geoUnknownSet(query.setName) : !set.current ? words.geoNoCurrent(set.name) : tags.data?.tags.length === 0 ? words.geoNoTags(query.q) : null
  return (
    <div className={styles.hint}>
      {note && <p className={styles.note}>{note}</p>}
      {!note &&
        tags.data?.tags.map((tag) => (
          <button
            key={tag.name}
            type="button"
            className={styles.hintRow}
            // Mouse down, not click: a click would take the focus from the field first and close the hint.
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(withGeoTag(line, query, tag.name))
            }}
          >
            <span>
              {query.prefix}
              {tag.name}
            </span>
            <span className={styles.note}>{words.geoEntries(tag.entries)}</span>
          </button>
        ))}
      {!note && tags.data && tags.data.total > tags.data.tags.length && <p className={styles.note}>{words.geoMore(tags.data.tags.length, tags.data.total)}</p>}
    </div>
  )
}

export interface MatchInputProps {
  label: string
  placeholder: string
  /** The rule's matchers as a line, as stored. */
  value: string
  /** Parsed on each key, but the text stays as typed: a half-typed separator must not vanish under the caret. */
  onChange: (line: string) => void
  bad?: boolean
  shadowed?: boolean
  withHint?: boolean
}

export function MatchInput({ label, placeholder, value, onChange, bad = false, shadowed = false, withHint = true }: MatchInputProps) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  const [hintClosed, setHintClosed] = useState(false)
  const shown = focused ? text : value
  const className = [styles.matchField, bad ? styles.matchBad : '', shadowed ? styles.matchShadowed : ''].filter(Boolean).join(' ')
  return (
    <div className={styles.match}>
      <input
        aria-label={label}
        aria-invalid={bad || undefined}
        className={className}
        placeholder={placeholder}
        value={shown}
        onFocus={() => {
          setText(value)
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setHintClosed(true)
        }}
        onChange={(e) => {
          setHintClosed(false)
          setText(e.target.value)
          onChange(e.target.value)
        }}
      />
      {withHint && focused && !hintClosed && (
        <TagHint
          line={text}
          onPick={(line) => {
            setText(line)
            onChange(line)
          }}
        />
      )}
    </div>
  )
}
