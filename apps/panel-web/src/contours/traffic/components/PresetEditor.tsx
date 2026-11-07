import { useMemo, useRef, useState } from 'react'
import { MatchInput } from '@/contours/traffic/components/MatchInput'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useDeletePreset, useSavePreset } from '@/contours/traffic/hooks/useRoutes'
import { findShadows, seedRules, strip } from '@/contours/traffic/lib/devicePresetRules'
import { NEW_PRESET_ID, presetWrite } from '@/contours/traffic/lib/devicePresets'
import { refusedTokens } from '@/contours/traffic/lib/ownLists'
import { presetRefusalWords } from '@/contours/traffic/lib/presetRefusal'
import { DEVICE_ACTIONS } from '@/contours/traffic/lib/routeActions'
import { splitMatch } from '@/contours/traffic/lib/routeRules'
import { DICT, sayer } from '@/contours/traffic/routesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { routingPresetRefusal, unknownInMatch, type RouteAction, type RouteRule, type RoutingPreset } from '@/lib/old/routePolicies'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

export interface PresetEditorProps {
  preset: RoutingPreset
  isDefault: boolean
  dns: string | undefined
  onDone: (id?: string) => void
}

/** A built-in is compiled into the subscription builder, so its rows are flat text and it has no delete; an own preset is a stored row. */
export function PresetEditor({ preset, isDefault, dns, onDone }: PresetEditorProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const say = sayer(words)
  const isNew = preset.id === NEW_PRESET_ID
  const locked = preset.builtIn
  const save = useSavePreset(isNew ? null : preset.id)
  const remove = useDeletePreset()
  const nextKey = useRef(0)
  const initial = useMemo(() => seedRules(preset.rules), [preset])
  const [name, setName] = useState(preset.name)
  const [rules, setRules] = useState<RouteRule[]>(initial)
  const [unknown, setUnknown] = useState<string[]>([])
  const [nameError, setNameError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const write = locked ? null : presetWrite(preset, name, strip(rules), strip(initial))
  const shadows = useMemo(() => findShadows(rules), [rules])
  const nameMissing = isNew && name.trim() === ''
  const hasRefused = rules.some((rule) => refusedTokens(rule.match).length > 0)
  const setRule = (i: number, next: Partial<RouteRule>) => {
    if (next.match) setUnknown([])
    setFailure(null)
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)))
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return
    setRules((prev) => {
      const next = [...prev]
      const [row] = next.splice(from, 1)
      if (row) next.splice(to, 0, row)
      return next
    })
  }
  const send = () => {
    if (!write) return
    setFailure(null)
    save.mutate(write.input, {
      onSuccess: (saved) => {
        toast.show(words.savedPreset)
        onDone(saved.id)
      },
      onError: (err) => {
        const read = routingPresetRefusal(err)
        if (read?.code === 'ROUTING_PRESET_ENTRY_UNKNOWN' || read?.code === 'ROUTING_PRESET_GEO_TAG_UNKNOWN') setUnknown(read.entries)
        if (read?.code === 'NAME_TAKEN') {
          setNameError(presetRefusalWords(read, say))
          return
        }
        setFailure(read ? presetRefusalWords(read, say) : failureText(err, locale))
      },
    })
  }
  const confirmDelete = () => {
    setDeleteError(null)
    remove.mutate(preset.id, {
      onSuccess: () => {
        toast.show(words.deletedPreset)
        onDone()
      },
      onError: (err) => {
        const read = routingPresetRefusal(err)
        setDeleteError(read ? presetRefusalWords(read, say) : failureText(err, locale))
      },
    })
  }
  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        {locked ? (
          <h2 className={styles.panelTitle}>{name}</h2>
        ) : (
          <div className={styles.nameField}>
            <Input
              aria-label={words.presetName}
              placeholder={words.presetName}
              value={name}
              onChange={(e) => {
                setNameError(null)
                setName(e.target.value)
              }}
            />
            {nameError && <p className={styles.danger}>{nameError}</p>}
          </div>
        )}
        {isDefault && <span className={styles.chip}>{words.isDefault}</span>}
        {locked && (
          <span className={styles.lockCell}>
            <Icon name="lock" size="sm" />
            {words.builtIn}
          </span>
        )}
        {write && !nameMissing && <span className={styles.amber}>{words.unsaved}</span>}
        <span className={styles.spacer} />
        {locked && <span className={styles.note}>{words.builtInNoDelete}</span>}
        {!locked && !isNew && (
          <Button variant="danger" onClick={() => setAsking(true)}>
            {words.deleteAction}
          </Button>
        )}
        {!locked && (
          <Button variant="primary" loading={save.isPending} disabled={!write || nameMissing || hasRefused} onClick={send}>
            {words.save}
          </Button>
        )}
      </div>
      {failure && <Banner tone="danger">{failure}</Banner>}
      <p className={styles.noteRow}>{words.firstMatchWins}</p>
      <div className={styles.rules}>
        <div className={styles.ruleHead}>
          <span>{words.colIf}</span>
          <span>{words.colDo}</span>
          <span>{words.colNote}</span>
        </div>
        {rules.length === 0 && <p className={styles.ruleQuiet}>{words.presetNoRules}</p>}
        {rules.map((rule, i) => {
          const shadow = shadows.get(rule.id)
          const bad = unknownInMatch(rule.match, unknown)
          const refused = refusedTokens(rule.match)
          if (locked) {
            return (
              <div key={rule.id} className={styles.ruleLocked}>
                <span className={styles.mono}>{rule.match.join(' · ')}</span>
                <span>{words.deviceAction[rule.action]}</span>
                <span className={styles.note}>{rule.note}</span>
              </div>
            )
          }
          return (
            <div key={rule.id} className={shadow ? styles.ruleShadowed : styles.rule} onDragOver={(e) => e.preventDefault()} onDrop={() => dragged !== null && move(dragged, i)}>
              <div className={styles.matchWithGrip}>
                <span className={styles.grip} draggable onDragStart={() => setDragged(i)} onDragEnd={() => setDragged(null)} aria-hidden>
                  <Icon name="grip" size="sm" />
                </span>
                <MatchInput withHint={false} label={words.matchField} placeholder={words.matchHolder} value={rule.match.join(' ')} bad={bad.length > 0 || refused.length > 0} shadowed={Boolean(shadow)} onChange={(line) => setRule(i, { match: splitMatch(line) })} />
              </div>
              <Select aria-label={words.actionField} value={rule.action} onChange={(e) => setRule(i, { action: e.target.value as RouteAction })} options={DEVICE_ACTIONS.map((a) => ({ value: a, label: words.deviceAction[a] }))} />
              <div className={styles.ruleNote}>
                {shadow ? <span className={styles.amber}>{words.shadowedBy(shadow)}</span> : <Input aria-label={words.noteField} placeholder={words.noteHolder} value={rule.note} onChange={(e) => setRule(i, { note: e.target.value })} />}
                {bad.length > 0 && <span className={styles.danger}>{words.presetEntryRow(bad.join(', '))}</span>}
                {refused.length > 0 && <span className={styles.danger}>{words.tokenRefused(refused.join(', '))}</span>}
              </div>
              <div className={styles.actions}>
                <Button size="sm" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  {words.moveUp}
                </Button>
                <Button size="sm" disabled={i === rules.length - 1} onClick={() => move(i, i + 1)}>
                  {words.moveDown}
                </Button>
                <Button size="sm" onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}>
                  {words.remove}
                </Button>
              </div>
            </div>
          )
        })}
        {!locked && (
          <div className={styles.ruleAdd}>
            <Button
              size="sm"
              icon={<Icon name="plus" size="sm" />}
              onClick={() => {
                nextKey.current += 1
                setRules((prev) => [...prev, { id: `new-${nextKey.current}`, match: [], action: 'direct', note: '' }])
              }}
            >
              {words.addRule}
            </Button>
          </div>
        )}
        <div className={styles.ruleLocked}>
          <span className={styles.lockCell}>
            <Icon name="geo" size="sm" />
            {words.everythingElse}
          </span>
          <span>{words.intoTunnel}</span>
          <span className={styles.note}>{words.intoTunnelNote}</span>
        </div>
      </div>
      <Banner tone="warn" title={words.notEveryoneTitle}>
        {words.notEveryoneBody}
      </Banner>
      {dns && (
        <p className={styles.noteRow}>
          {words.dnsLabel} <span className={styles.mono}>{dns}</span>. {words.dnsNote}
        </p>
      )}
      <p className={locked ? styles.noteRow : styles.amber}>{locked ? words.presetReadOnly : words.presetOwn}</p>
      {asking && (
        <Confirm title={words.presetDeleteTitle(preset.name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: deleteError }} onConfirm={confirmDelete} onClose={() => setAsking(false)}>
          <p>{words.presetDeleteBody}</p>
        </Confirm>
      )}
    </section>
  )
}
