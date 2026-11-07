import { useState } from 'react'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useCreateOutbound, useUpdateOutbound } from '@/contours/traffic/hooks/useOutbounds'
import { outboundCreateBody, outboundFormValues, outboundProblems, outboundUpdateBody, type OutboundFormValues } from '@/contours/traffic/lib/namedOutboundForm'
import { DICT } from '@/contours/traffic/outboundsDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { COUNTRY_OPTIONS } from '@/lib/old/countries'
import { CREATABLE_OUTBOUND_TYPES, namedOutboundRefusal, OUTBOUND_FINGERPRINTS, type NamedOutbound, type NamedOutboundType, type OutboundSecurity } from '@/lib/old/namedOutbounds'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input, PasswordInput } from '@/ui/Field/Field'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

const SECURITIES: readonly OutboundSecurity[] = ['none', 'tls', 'reality']

type Key = keyof OutboundFormValues

export interface OutboundWindowProps {
  /** null: a new one. */
  stored: NamedOutbound | null
  onClose: () => void
}

/** The form by type: common fields, then vless or socks. An imported freedom or blackhole keeps its type, only its name and country change. */
export function OutboundWindow({ stored, onClose }: OutboundWindowProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const create = useCreateOutbound()
  const update = useUpdateOutbound(stored?.id ?? '')
  const [v, setV] = useState<OutboundFormValues>(() => outboundFormValues(stored))
  const [tried, setTried] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const problems = outboundProblems(v)
  const hasProblems = Object.keys(problems).length > 0
  const pending = create.isPending || update.isPending
  const set = <K extends Key>(key: K, value: OutboundFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setServerErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  const errorOf = (key: Key) => {
    const problem = problems[key]
    return serverErrors[key] ?? (tried && problem ? words.problem[problem] : undefined)
  }
  const failed = (err: unknown) => {
    const read = namedOutboundRefusal(err)
    if (read?.code === 'NAME_TAKEN') {
      setServerErrors({ name: words.refused.nameTaken(read.name) })
      return
    }
    if (read?.code === 'VALIDATION') {
      setServerErrors(Object.fromEntries(read.issues.map((issue) => [issue.field, issue.message])))
      setRefusal(words.refused.validation)
      return
    }
    if (read?.code === 'IN_USE') {
      setRefusal(words.refused.inUse)
      return
    }
    if (read?.code === 'TYPE_NOT_FOR_DIRECTION') {
      setRefusal(words.refused.typeNotForDirection(read.type))
      return
    }
    setRefusal(failureText(err, locale))
  }
  const submit = () => {
    setTried(true)
    setRefusal(null)
    if (hasProblems) return
    if (!stored) {
      create.mutate(outboundCreateBody(v), {
        onSuccess: () => {
          toast.show(words.created)
          onClose()
        },
        onError: failed,
      })
      return
    }
    // Nothing changed: no request, the window just closes.
    const body = outboundUpdateBody(stored, v)
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    update.mutate(body, {
      onSuccess: () => {
        toast.show(words.saved)
        onClose()
      },
      onError: failed,
    })
  }
  const imported = !CREATABLE_OUTBOUND_TYPES.includes(v.type)
  const types: readonly NamedOutboundType[] = imported ? [v.type] : CREATABLE_OUTBOUND_TYPES
  const secured = v.security !== 'none'
  const text = (key: Key, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={errorOf(key)}>
      {(a11y) => <Input {...a11y} value={String(v[key])} onChange={(e) => set(key, e.target.value as never)} />}
    </Field>
  )
  return (
    <Dialog
      title={stored ? words.editTitle(stored.name) : words.newTitle}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={pending} disabled={tried && hasProblems} onClick={submit}>
            {stored ? words.save : words.create}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <div className={styles.twoFields}>
          {text('name', words.field.name, words.field.nameHint)}
          <Field label={words.field.country}>{(a11y) => <Select {...a11y} value={v.countryCode} onChange={(e) => set('countryCode', e.target.value)} options={[{ value: '', label: words.field.countryNone }, ...COUNTRY_OPTIONS]} />}</Field>
        </div>
        <Segmented label={words.field.type} value={v.type} onChange={(type) => set('type', type)} options={types.map((type) => ({ value: type, label: type }))} />
        {imported && <p className={styles.note}>{words.importedNote}</p>}
        {!imported && (
          <div className={styles.threeFields}>
            {text('server', words.field.server)}
            <Field label={words.field.port} error={errorOf('port')}>
              {(a11y) => (
                <Input
                  {...a11y}
                  inputMode="numeric"
                  value={String(v.port)}
                  onChange={(e) => {
                    const typed = e.target.value.trim()
                    set('port', typed === '' || Number.isNaN(Number(typed)) ? '' : Number(typed))
                  }}
                />
              )}
            </Field>
          </div>
        )}
        {v.type === 'vless' && (
          <>
            {text('uuid', words.field.uuid)}
            <Segmented label={words.field.security} value={v.security} onChange={(security) => set('security', security)} options={SECURITIES.map((security) => ({ value: security, label: security }))} />
            <Switch label={`${words.field.vision} (${words.field.visionHint})`} checked={secured && v.vision} disabled={!secured} onChange={(next) => set('vision', next)} />
            {secured && (
              <div className={styles.threeFields}>
                {text('sni', words.field.sni)}
                <Field label={words.field.fingerprint}>{(a11y) => <Select {...a11y} value={v.fingerprint} onChange={(e) => set('fingerprint', e.target.value)} options={[{ value: '', label: words.field.fingerprintNone }, ...OUTBOUND_FINGERPRINTS.map((value) => ({ value, label: value }))]} />}</Field>
                {text('alpn', words.field.alpn, words.field.alpnHint)}
              </div>
            )}
            {v.security === 'reality' && (
              <div className={styles.twoFields}>
                {text('realityPublicKey', words.field.realityPublicKey)}
                {text('realityShortId', words.field.realityShortId, words.field.realityShortIdHint)}
              </div>
            )}
            <p className={styles.note}>{words.transportNote}</p>
          </>
        )}
        {v.type === 'socks' && (
          <>
            <div className={styles.twoFields}>
              {text('username', words.field.username)}
              <Field label={words.field.password} error={errorOf('password')}>
                {(a11y) => <PasswordInput {...a11y} showLabel={words.field.showPassword} hideLabel={words.field.hidePassword} value={v.password} onChange={(e) => set('password', e.target.value)} />}
              </Field>
            </div>
            <p className={styles.amber}>{words.socksNote}</p>
          </>
        )}
        {refusal && <Banner tone="danger">{refusal}</Banner>}
      </div>
    </Dialog>
  )
}
