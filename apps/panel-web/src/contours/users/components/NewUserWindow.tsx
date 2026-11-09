import { useEffect, useState } from 'react'
import { EstimateBlock, SavePresetWindow } from '@/contours/users/components/NewUserParts'
import { AdvancedFields, SquadField, TermField, TrafficField } from '@/contours/users/components/UserFields'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { useCreateUser, useUsersList } from '@/contours/users/hooks/useUsers'
import { presetDays } from '@/contours/users/lib/estimate'
import { randomUsername, usernameValid } from '@/contours/users/lib/newUser'
import { DEFAULT_PRESETS, loadPresets, savePresets, withPreset, type UserPreset } from '@/contours/users/lib/presets'
import { readSaveRefusal, type SaveRefusal } from '@/contours/users/lib/refusal'
import { expireFromParts } from '@/contours/users/lib/term'
import { createBody, deviceLimitValid, limitError, limitToGb, type UserDraft } from '@/contours/users/lib/userBody'
import { widenedBy } from '@/contours/users/lib/widen'
import { useNow } from '@/lib/clock'
import type { NodeRow } from '@/lib/domain/nodes'
import { ALL_SQUAD_ID, type Squad } from '@/lib/domain/squads'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const blankDraft = (preset: UserPreset | undefined, now: number): UserDraft => ({
  status: 'active',
  groupIds: [ALL_SQUAD_ID],
  unlimited: preset ? preset.trafficGb === null : false,
  limitText: preset?.trafficGb != null ? String(preset.trafficGb) : '',
  limitUnit: 'GB',
  strategy: preset?.strategy ?? 'no_reset',
  noExpiry: preset ? preset.expireDays === null : false,
  expireAt: expireFromParts({ days: preset?.expireDays ?? 30, hours: 0 }, now),
  email: '',
  telegramId: '',
  deviceLimit: '',
  tag: '',
  description: '',
})

function NameField({ value, onChange, error }: { value: string; onChange: (next: string) => void; error?: string }) {
  const words = useDict(DICT)
  const name = value.trim()
  const valid = usernameValid(name)
  const [debounced, setDebounced] = useState(name)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(name), 300)
    return () => clearTimeout(timer)
  }, [name])
  // The old server has no "is this free" request: its search answers it, and the save still decides.
  const same = useUsersList({ search: debounced || '-', limit: 5, page: 1 })
  const taken = valid && debounced === name && same.data?.users.some((u) => u.username === name)
  const free = valid && debounced === name && same.data !== undefined && !taken
  const refusal = error ?? (taken ? words.nameTaken : name !== '' && !valid ? words.nameRule : undefined)
  return (
    <Field label={words.name} error={refusal}>
      {(a11y) => (
        <span className={styles.nameBox}>
          <Input {...a11y} name="username" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
          {free && <span className={styles.nameFree}>{words.nameFree}</span>}
          <button type="button" className={styles.iconButton} aria-label={words.nameRandom} onClick={() => onChange(randomUsername())}>
            <Icon name="dice" size="lg" />
          </button>
        </span>
      )}
    </Field>
  )
}

export interface NewUserWindowProps {
  squads: readonly Squad[]
  squadsFailed: boolean
  nodes: ReadonlyMap<string, NodeRow>
  onClose: () => void
}

export function NewUserWindow({ squads, squadsFailed, nodes, onClose }: NewUserWindowProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const toast = useToast()
  const create = useCreateUser()
  const [presets, setPresets] = useState(loadPresets)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetId, setPresetId] = useState(DEFAULT_PRESETS[0]?.id ?? '')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [draft, setDraft] = useState<UserDraft>(() => blankDraft(presets.find((p) => p.id === presetId), now()))
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [asking, setAsking] = useState<null | { next: boolean }>(null)
  const patch = (next: Partial<UserDraft>) => setDraft((d) => ({ ...d, ...next }))
  const errors = refusal?.fields ?? {}
  const limitBad = limitError(draft, true, words.limitBad) !== undefined
  const ready = usernameValid(username.trim()) && !limitBad && deviceLimitValid(draft.deviceLimit)

  const pickPreset = (id: string) => {
    setPresetId(id)
    const keep = { groupIds: draft.groupIds, email: draft.email, telegramId: draft.telegramId, deviceLimit: draft.deviceLimit, tag: draft.tag, description: draft.description }
    setDraft({ ...blankDraft(presets.find((p) => p.id === id), now()), ...keep })
  }

  const trafficGb = draft.unlimited ? null : limitToGb(draft.limitText, draft.limitUnit)
  const expireDays = presetDays(draft.noExpiry, draft.expireAt, now())
  const presetSummary = words.presetSummary(trafficGb === null ? words.presetUnlimited : `${trafficGb} ГБ`, expireDays === null ? words.presetNoTerm : `${expireDays} ${words.daysUnit}`, words.strategy[draft.strategy] ?? draft.strategy)
  const savePreset = (name: string) => {
    const { list, saved } = withPreset(presets, { name, trafficGb, expireDays, strategy: draft.strategy })
    savePresets(list)
    setPresets(list)
    setPresetId(saved.id)
    setSavingPreset(false)
    toast.show(words.presetSaved(saved.name))
  }

  const send = (next: boolean) => {
    setRefusal(null)
    create.mutate(createBody({ username, subscriptionToken: token }, draft), {
      onSuccess: (user) => {
        toast.show(words.createdDone(user.username))
        if (next) setUsername('')
        else onClose()
      },
      onError: (err) => {
        const read = readSaveRefusal(err)
        if (read) {
          if (read.code === 'USERNAME_TAKEN') read.fields.username = words.nameTaken
          if (read.code === 'SUBSCRIPTION_TOKEN_TAKEN') read.fields.subscriptionToken = words.tokenTaken
          setRefusal(read)
          if (read.fields.subscriptionToken) setAdvanced(true)
        } else toast.show(failureText(err, locale), 'failed')
      },
    })
  }
  const submit = (next: boolean) => {
    if (widenedBy([], draft.groupIds, squads)) setAsking({ next })
    else send(next)
  }
  const widen = widenedBy([], draft.groupIds, squads)

  return (
    <Dialog
      size="window"
      title={words.newUser}
      closeLabel={words.close}
      onClose={onClose}
      footer={
        <>
          <span className={styles.footNote}>{refusal?.message ?? words.createNote}</span>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button disabled={!ready} loading={create.isPending} onClick={() => submit(true)}>
            {words.createAndNext}
          </Button>
          <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={() => submit(false)}>
            {words.create}
          </Button>
        </>
      }
    >
      <div className={styles.windowColumns}>
        <div className={styles.windowLeft}>
          <Field label={words.preset}>
            {(a11y) => (
              <Select
                {...a11y}
                value={presetId}
                onChange={(e) => pickPreset(e.target.value)}
                options={[
                  { value: '', label: words.presetNone },
                  ...presets.map((p) => ({ value: p.id, label: `${p.name}: ${words.presetHint(p.trafficGb === null ? words.presetUnlimited : `${p.trafficGb} ГБ`, p.expireDays === null ? words.presetNoTerm : `${p.expireDays} ${words.daysUnit}`)}` })),
                ]}
              />
            )}
          </Field>
          <button type="button" className={styles.presetSave} disabled={!draft.unlimited && trafficGb === null} onClick={() => setSavingPreset(true)}>
            {words.presetSave}
          </button>
          <NameField value={username} onChange={setUsername} error={errors.username} />
          <SquadField squads={squads} value={draft.groupIds} failed={squadsFailed} error={errors.groups} onChange={(groupIds) => patch({ groupIds })} />
          <TrafficField draft={draft} onChange={patch} errors={errors} limitTouched />
          <TermField draft={draft} onChange={patch} errors={errors} limitTouched />
        </div>
        <div className={styles.windowRight}>
          <EstimateBlock picked={draft.groupIds} squads={squads} nodes={nodes} />
        </div>
      </div>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <button type="button" className={styles.advancedToggle} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size="md" />
            {words.advanced}
          </button>
          <span className={styles.blockAside}>{words.advancedHint}</span>
        </div>
        {advanced && (
          <>
            <AdvancedFields draft={draft} onChange={patch} errors={errors} />
            <Field label={words.token} error={errors.subscriptionToken} hint={words.tokenHint}>
              {(a11y) => <Input {...a11y} value={token} onChange={(e) => setToken(e.target.value)} />}
            </Field>
          </>
        )}
      </section>
      {savingPreset && <SavePresetWindow summary={presetSummary} taken={(name) => presets.some((p) => p.name === name)} onSave={savePreset} onClose={() => setSavingPreset(false)} />}
      {asking && widen && (
        <Confirm
          title={words.emptySquadWidenTitle}
          labels={{ confirm: words.saveAnyway, cancel: words.cancel }}
          tone="warn"
          onClose={() => setAsking(null)}
          onConfirm={() => {
            send(asking.next)
            setAsking(null)
          }}
        >
          {words.emptySquadWiden(widen.empty.name, widen.narrowed.map((s) => s.name).join(', '))}
        </Confirm>
      )}
    </Dialog>
  )
}
