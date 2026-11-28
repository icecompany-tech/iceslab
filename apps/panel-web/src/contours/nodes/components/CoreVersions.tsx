import { componentsOfEngine, type CoreComponent, type NodeCoreVersions } from '@iceslab/shared'
import { useId } from 'react'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { corePickable } from '@/contours/nodes/lib/nodeCreateForm'
import { useDict } from '@/lib/i18n'
import { coreVersionChoices } from '@/lib/old/coreVersions'
import { Banner } from '@/ui/Banner/Banner'

export function CoreVersions({ selected, value, onChange, refusal }: {
  selected: string
  value: NodeCoreVersions
  onChange: (next: NodeCoreVersions) => void
  refusal: readonly string[] | null
}) {
  const words = useDict(DICT)
  const id = useId()
  const components = componentsOfEngine(selected)
  const change = (component: CoreComponent, release: string) => {
    const next = { ...value }
    if (release) next[component] = release
    else delete next[component]
    onChange(next)
  }
  return <section className={styles.versions} aria-label={words.coreVersionsTitle}>
    <h3 className={styles.subTitle}>{words.coreVersionsTitle}</h3>
    {refusal && <Banner tone="danger" title={words.coreVersionsRefused}>{refusal.map(line => <div key={line}>{line}</div>)}</Banner>}
    {!components.length && <p className={styles.note}>{words.coreVersionsNone}</p>}
    {components.map(component => {
      if (!corePickable(component)) return <p key={component} className={styles.note}>{component} · {words.coreVersionBuilt}</p>
      const choices = coreVersionChoices(component)
      const pin = value[component] ?? ''
      return <fieldset key={component} className={styles.versionChoices}>
        <legend>{component}</legend>
        {choices.map(choice => <label key={choice.value} className={styles.versionChoice}>
          <input type="radio" name={id + component} checked={pin === choice.value} disabled={choice.blocked !== null}
            onChange={() => change(component, choice.value)} />
          <span>{words.coreChoice[choice.kind](choice.v)}
            {choice.blocked && <small>{words.coreClosed(choice.v, words.coreBlocked[choice.blocked.kind], choice.blocked.reason)}</small>}
          </span>
        </label>)}
        {pin && !choices.some(choice => choice.value === pin) && <p className={styles.note}>{pin} · {words.coreNoCommand}</p>}
      </fieldset>
    })}
    <p className={styles.note}>{words.coreChoiceNote}</p>
  </section>
}
