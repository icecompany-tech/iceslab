// The left column shared by the new user and the user window: squads, traffic, term.
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import type { FormField } from '@/contours/users/lib/refusal'
import { expireFromParts, termLeft } from '@/contours/users/lib/term'
import { limitError, type LimitUnit, type UserDraft } from '@/contours/users/lib/userBody'
import { useNow } from '@/lib/clock'
import type { Squad } from '@/lib/domain/squads'
import { useDict, useLocale } from '@/lib/i18n'
import { LazyDateTimeField } from '@/ui/DateTimeField/LazyDateTimeField'
import { Field, Input } from '@/ui/Field/Field'
import { LazySquadSelect } from '@/ui/SquadSelect/LazySquadSelect'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'
import type { SquadSelectTexts } from '@/ui/SquadSelect/SquadSelect'

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const STRATEGIES = ['no_reset', 'day', 'week', 'month', 'rolling'] as const

export interface FieldsProps {
  draft: UserDraft
  onChange: (patch: Partial<UserDraft>) => void
  errors: Partial<Record<FormField, string>>
  /** True when the limit field was changed from what the server stored. */
  limitTouched: boolean
  storedLimit?: string
}

export function SquadField({ squads, value, onChange, error, failed }: { squads: readonly Squad[]; value: readonly string[]; onChange: (next: string[]) => void; error?: string; failed: boolean }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const texts: SquadSelectTexts = {
    placeholder: words.squadsPlaceholder,
    search: words.squadSearch,
    empty: words.squadEmpty,
    allGroup: words.squadAll,
    clearAll: words.squadClear,
    clearSearch: words.squadClearSearch,
    remove: words.squadRemove,
    selectedGroup: words.squadSelectedGroup,
    selectedFooter: words.squadFooter,
    foundFooter: words.squadFound,
  }
  if (failed) return <div role="alert" className={styles.formError}>{words.squadsFailed}</div>
  return (
    <div>
      <LazySquadSelect locale={locale} label={words.squads} options={squads.map((s) => ({ id: s.id, name: s.name }))} value={value} onChange={onChange} texts={texts} />
      {error && <div role="alert" className={styles.formError}>{error}</div>}
    </div>
  )
}

export function TrafficField({ draft, onChange, errors, limitTouched, storedLimit }: FieldsProps) {
  const words = useDict(DICT)
  const refused = errors.limit ?? limitError(draft, limitTouched, words.limitBad)
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupLabel}>{words.traffic}</span>
        <Switch label={words.noLimit} checked={draft.unlimited} onChange={(on) => onChange({ unlimited: on })} />
      </div>
      {draft.unlimited ? (
        <div className={styles.grayLine}>{words.noLimitNote}</div>
      ) : (
        <div className={styles.trafficRow}>
          <Field labelHidden label={words.limitLabel} error={refused} hint={limitTouched || !storedLimit ? words.limitWhole : words.limitStored(storedLimit)}>
            {(a11y) => (
              <span className={styles.limitBox}>
                <Input {...a11y} inputMode="decimal" value={draft.limitText} onChange={(e) => onChange({ limitText: e.target.value })} />
                <span className={styles.unit}>
                  <Select aria-label={words.limitUnit} value={draft.limitUnit} onChange={(e) => onChange({ limitUnit: e.target.value as LimitUnit })} options={[{ value: 'GB', label: words.gb }, { value: 'TB', label: words.tb }]} />
                </span>
              </span>
            )}
          </Field>
          <Field labelHidden label={words.strategyLabel} error={errors.strategy}>
            {(a11y) => <Select {...a11y} value={draft.strategy} onChange={(e) => onChange({ strategy: e.target.value })} options={STRATEGIES.map((value) => ({ value, label: words.strategy[value] ?? value }))} />}
          </Field>
        </div>
      )}
    </div>
  )
}

export function TermField({ draft, onChange, errors, leftLabel }: FieldsProps & { leftLabel?: boolean }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const at = now()
  const left = draft.expireAt ? termLeft(draft.expireAt, at) : { days: 0, hours: 0 }
  const part = (key: 'days' | 'hours', text: string) => {
    const n = Number(text)
    if (!Number.isInteger(n) || n < 0) return
    onChange({ expireAt: expireFromParts({ ...left, [key]: n }, at) })
  }
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupLabel}>{leftLabel ? words.termLeft : words.term}</span>
        <Switch label={words.noTermSwitch} checked={draft.noExpiry} onChange={(on) => onChange({ noExpiry: on, expireAt: on ? draft.expireAt : (draft.expireAt ?? expireFromParts({ days: 30, hours: 0 }, at)) })} />
      </div>
      {draft.noExpiry ? (
        <div className={styles.grayLine}>{words.noTermNote}</div>
      ) : (
        <div className={styles.termRow}>
          <Field labelHidden label={words.termDays}>{(a11y) => <span className={styles.suffixBox}><Input {...a11y} inputMode="numeric" value={String(left.days)} onChange={(e) => part('days', e.target.value)} /><span className={styles.suffix}>{words.daysUnit}</span></span>}</Field>
          <Field labelHidden label={words.termHours}>{(a11y) => <span className={styles.suffixBox}><Input {...a11y} inputMode="numeric" value={String(left.hours)} onChange={(e) => part('hours', e.target.value)} /><span className={styles.suffix}>{words.hoursUnit}</span></span>}</Field>
          <LazyDateTimeField
            locale={locale}
            label={words.termDate}
            value={draft.expireAt}
            timeZone={TIME_ZONE}
            error={errors.term}
            onChange={(next) => next && onChange({ expireAt: next })}
            texts={{ open: words.calendarOpen, previousMonth: words.calendarPrev, nextMonth: words.calendarNext }}
          />
        </div>
      )}
    </div>
  )
}

export function AdvancedFields({ draft, onChange, errors }: Pick<FieldsProps, 'draft' | 'onChange' | 'errors'>) {
  const words = useDict(DICT)
  const badDevices = draft.deviceLimit.trim() !== '' && !/^\d+$/.test(draft.deviceLimit.trim())
  return (
    <div className={styles.advanced}>
      <div className={styles.advancedRow}>
        <Field label={words.email} error={errors.email}>{(a11y) => <Input {...a11y} type="email" value={draft.email} onChange={(e) => onChange({ email: e.target.value })} />}</Field>
        <Field label={words.telegramId} error={errors.telegramId} hint={words.telegramHint}>{(a11y) => <Input {...a11y} value={draft.telegramId} onChange={(e) => onChange({ telegramId: e.target.value })} />}</Field>
        <Field label={words.deviceLimit} error={errors.deviceLimit ?? (badDevices ? words.deviceLimitBad : undefined)} hint={words.deviceLimitHint}>{(a11y) => <Input {...a11y} inputMode="numeric" value={draft.deviceLimit} onChange={(e) => onChange({ deviceLimit: e.target.value })} />}</Field>
        <Field label={words.tag} error={errors.tag}>{(a11y) => <Input {...a11y} value={draft.tag} onChange={(e) => onChange({ tag: e.target.value })} />}</Field>
      </div>
      <Field label={words.note} error={errors.description}>
        {(a11y) => <textarea {...a11y} className={styles.note} placeholder={words.notePlaceholder} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} />}
      </Field>
    </div>
  )
}
