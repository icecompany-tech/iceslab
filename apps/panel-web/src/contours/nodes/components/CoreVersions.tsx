import type { CoreComponent, NodeCoreVersions } from '@iceslab/shared'
import { useState } from 'react'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { corePickable, wizardCoreComponents } from '@/contours/nodes/lib/nodeCreateForm'
import { useDict } from '@/lib/i18n'
import { coreVersionChoices } from '@/lib/old/coreVersions'
import { Banner } from '@/ui/Banner/Banner'
import { Field } from '@/ui/Field/Field'
import { Select } from '@/ui/Select/Select'

function VersionRow({ component, value, onChange }: { component: CoreComponent; value: NodeCoreVersions; onChange: (next: NodeCoreVersions) => void }) {
  const words = useDict(DICT)
  if (!corePickable(component)) {
    return (
      <div className={styles.versionRow}>
        <span className={styles.mono}>{component}</span>
        <span className={styles.note}>{words.coreVersionBuilt}</span>
      </div>
    )
  }
  const choices = coreVersionChoices(component)
  // The browser's own list cannot close one option with a reason, so a closed release is named below it.
  const open = choices.filter((c) => c.blocked === null)
  const closed = choices.filter((c) => c.blocked !== null)
  return (
    <div className={styles.versionRow}>
      <Field label={component}>
        {(a11y) => (
          <Select
            {...a11y}
            value={value[component] ?? ''}
            options={open.map((c) => ({ value: c.value, label: words.coreChoice[c.kind](c.v) }))}
            onChange={(e) => {
              const next = { ...value }
              if (e.target.value === '') delete next[component]
              else next[component] = e.target.value
              onChange(next)
            }}
          />
        )}
      </Field>
      {closed.map((c) => (
        <p key={c.value} className={styles.note}>
          {words.coreClosed(c.v, c.blocked ? words.coreBlocked[c.blocked.kind] : '', c.blocked?.reason ?? '')}
        </p>
      ))}
    </div>
  )
}

export interface CoreVersionsProps {
  /** The engines the node carries: their components first, the rest folded. */
  engines: readonly string[]
  value: NodeCoreVersions
  onChange: (next: NodeCoreVersions) => void
  /** The server's lines on CORE_VERSION_NOT_LISTED. */
  refusal: readonly string[] | null
}

/** One picker for the create page and the node page, so the two never offer different lists or words. */
export function CoreVersions({ engines, value, onChange, refusal }: CoreVersionsProps) {
  const words = useDict(DICT)
  const [othersOpen, setOthersOpen] = useState(false)
  const { relevant, others } = wizardCoreComponents(engines)
  // A choice in the folded group is not hidden: the group opens when something there is set.
  const othersShown = othersOpen || others.some((c) => value[c] !== undefined)
  return (
    <section className={styles.versions} aria-label={words.coreVersionsTitle}>
      <h3 className={styles.subTitle}>{words.coreVersionsTitle}</h3>
      {refusal && (
        <Banner tone="danger" title={words.coreVersionsRefused}>
          {refusal.map((line) => (
            <div key={line} className={styles.mono}>
              {line}
            </div>
          ))}
        </Banner>
      )}
      {relevant.length === 0 ? <p className={styles.note}>{words.coreVersionsNone}</p> : relevant.map((c) => <VersionRow key={c} component={c} value={value} onChange={onChange} />)}
      {others.length > 0 && (
        <button type="button" className={styles.textButton} aria-expanded={othersShown} onClick={() => setOthersOpen(!othersOpen)}>
          {words.coreVersionsOthers(others.length)}
        </button>
      )}
      {othersShown && others.map((c) => <VersionRow key={c} component={c} value={value} onChange={onChange} />)}
      <p className={styles.note}>{words.coreChoiceNote}</p>
    </section>
  )
}
