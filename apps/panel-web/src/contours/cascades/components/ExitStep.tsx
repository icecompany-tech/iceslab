import { Link } from 'react-router-dom'
import { PoolField } from '@/contours/cascades/components/PoolField'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import type { CascadeForm } from '@/contours/cascades/hooks/useCascadeForm'
import { directionLines, directionVia, entryChainNotes, outboundChainGaps, type DirectionDraft, type DirectionVia } from '@/contours/cascades/lib/cascadeForm'
import { nextFreeKey, nextFreeTag } from '@/contours/cascades/lib/draft'
import { useDict } from '@/lib/i18n'
import { COUNTRIES } from '@/lib/old/countries'
import { outboundAddress } from '@/lib/old/namedOutbounds'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Field } from '@/ui/Field/Field'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

function countryOptions(current: string, words: typeof DICT.ru) {
  const list = COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))
  return [{ value: '', label: words.countryPlaceholder }, ...(current && !COUNTRIES.some((c) => c.code === current) ? [{ value: current, label: current }] : []), ...list]
}

function DirectionRow({ form, direction, index }: { form: CascadeForm; direction: DirectionDraft; index: number }) {
  const words = useDict(DICT)
  const { directions, nextTag } = form.draft
  const via = directionVia(direction)
  const refusal = form.refusal?.kind === 'direction' ? form.refusal.refusal : null
  const say = (key: string, opts?: Record<string, unknown>): string => {
    const n = Number(opts?.n ?? 0)
    switch (key) {
      case 'cascadeCreate.directionEmpty':
        return words.directionEmpty(n)
      case 'cascadeCreate.outboundTaken':
        return words.outboundTaken(n)
      case 'cascadeCreate.directionRefused.DIRECTION_OUTBOUND_AND_NODES':
        return words.directionBoth(n)
      case 'cascadeCreate.directionRefused.DIRECTION_EMPTY':
        return words.directionHollow(n)
      case 'cascadeCreate.directionRefused.notFound':
        return words.directionNotFound
      case 'cascadeCreate.directionRefused.type':
        return words.directionType(String(opts?.type ?? ''))
      default:
        return key
    }
  }
  const pickVia = (next: DirectionVia) => form.setDirection(index, { via: next, outboundTouched: true, ...(next === 'outbound' ? { nodeIds: [''] } : { outboundId: null }) })
  const pickOutbound = (id: string) => {
    const o = form.outboundOptions.find((x) => x.id === id)
    form.setDirection(index, { outboundId: id || null, outboundTouched: true, ...(o?.countryCode && !direction.countryCode ? { countryCode: o.countryCode } : {}) })
  }
  return (
    <div className={styles.hopRow}>
      <div className={styles.hopHead}>
        <span className={direction.tag === null ? styles.tagNew : styles.tag}>
          {words.directionTag} {direction.tag ?? nextFreeTag(directions, index, nextTag)}
        </span>
        <span className={styles.spacer} />
        <Button size="sm" disabled={directions.length < 2} onClick={() => form.patch({ directions: directions.filter((_, j) => j !== index) })}>
          {words.remove}
        </Button>
      </div>
      <Field label={words.direction}>{(a11y) => <Select {...a11y} value={direction.countryCode} onChange={(e) => form.setDirection(index, { countryCode: e.target.value })} options={countryOptions(direction.countryCode, words)} />}</Field>
      {form.outboundKnown && (
        <Segmented<DirectionVia> label={words.via} value={via} onChange={pickVia} options={[{ value: 'pool', label: words.viaPool }, { value: 'outbound', label: words.viaOutbound }]} />
      )}
      {via === 'pool' ? (
        <PoolField form={form} label={words.poolDirection} ids={direction.nodeIds} onChange={(ids) => form.setDirection(index, { nodeIds: ids })} />
      ) : form.outbounds.isError ? (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void form.outbounds.refetch()}>
          {words.outboundFailed}
        </QueryFailedLine>
      ) : form.outbounds.data && form.outboundOptions.length === 0 ? (
        <p className={styles.note}>
          {words.outboundNone} <Link className={styles.link} to="/outbounds">{words.open}</Link>
        </p>
      ) : (
        <Field label={words.outboundField}>{(a11y) => <Select {...a11y} value={direction.outboundId ?? ''} onChange={(e) => pickOutbound(e.target.value)} options={[{ value: '', label: words.outboundPick }, ...form.outboundOptions.map((o) => ({ value: o.id, label: `${o.name} ${outboundAddress(o)}` }))]} />}</Field>
      )}
      {directionLines(directions, index, refusal, say).map((line) => (
        <p key={line} className={styles.danger}>
          {line}
        </p>
      ))}
    </div>
  )
}

export function ExitStep({ form }: { form: CascadeForm }) {
  const words = useDict(DICT)
  const { directions, pools } = form.draft
  const tags = form.refusal?.kind === 'tags' ? form.refusal : null
  const needsChain = form.refusal?.kind === 'direction' && form.refusal.refusal.kind === 'needsChain' ? form.refusal.refusal.conflicts : []
  const notes = entryChainNotes(outboundChainGaps(directions, (pools[pools.length - 1]?.nodeIds ?? []).map((id) => form.nodeById.get(id))), needsChain)
  return (
    <>
      {directions.map((d, i) => (
        <DirectionRow key={d.key} form={form} direction={d} index={i} />
      ))}
      {notes.map((c) => (
        <p key={c.nodeName} className={styles.danger}>
          {words.outboundNeedsChain(c.nodeName, c.engines.length > 0 ? c.engines.join(', ') : words.legNodeNoEngines)}
        </p>
      ))}
      {tags && (
        <Banner
          tone="danger"
          title={words.tagsTitle}
          action={
            <Link className={styles.link} to="/cascades/new">
              {words.tagsAction}
            </Link>
          }
        >
          {words.tagsBody(tags.needed, tags.available)}
        </Banner>
      )}
      <div className={styles.addRow}>
        <Button size="sm" disabled={tags !== null} onClick={() => form.patch({ directions: [...directions, { key: nextFreeKey([...directions, ...pools]), id: null, countryCode: '', nodeIds: [''], tag: null }] })}>
          {words.addDirection}
        </Button>
        <span className={styles.note}>{words.tagOnce}</span>
      </div>
      <p className={styles.note}>{words.directionsFoot}</p>
    </>
  )
}
