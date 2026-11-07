import { DEFAULT_FORMAT_NAMES, type RoutingPresetId } from '@iceslab/shared'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/contours/subscription/components/subscription.module.css'
import { DICT } from '@/contours/subscription/dict'
import { usePreviewUrl, useProbeAddress, useSaveSettings, useSettings, type PreviewState } from '@/contours/subscription/hooks/useSubscription'
import { activeCountOf, previewView } from '@/contours/subscription/lib/deliveryView'
import { previewPath } from '@/contours/subscription/lib/previewPath'
import { DEAD_STATES, draftOfSettings, intervalValid, paramsBody, sampleBytes, supportUrlValid, type ParamsDraft } from '@/contours/subscription/lib/paramsBody'
import { probeVerdict } from '@/contours/subscription/lib/probeVerdict'
import { useNow } from '@/lib/clock'
import { fmtDate, fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { ROUTING_PRESET_IDS } from '@/lib/old/routingPresets'
import type { AdminSettings, DeadTextState, SubscriptionFormat, SubscriptionProbe } from '@/lib/old/settings'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { RadioRow } from '@/ui/RadioRow/RadioRow'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

const PLACEHOLDERS = ['{{TRAFFIC_LEFT}}', '{{DAYS_LEFT}}', '{{SUPPORT_URL}}'] as const
const PREVIEW_STATES: readonly PreviewState[] = ['active', 'expiring', 'expired', 'limited', 'disabled']
const SAMPLE = { totalBytes: 53_687_091_200, usedBytes: 7_900_000_000, daysLeft: 12 }
const MS_IN_SECOND = 1000
const DAY_SECONDS = 86_400

function HeaderSample({ draft, brandName }: { draft: ParamsDraft; brandName: string }) {
  const words = useDict(DICT)
  const now = useNow()
  const support = draft.supportUrl.trim()
  const title = draft.profileTitle.trim() || brandName
  const announce = draft.announce.trim().replaceAll('{{TRAFFIC_LEFT}}', sampleBytes(SAMPLE.totalBytes - SAMPLE.usedBytes)).replaceAll('{{DAYS_LEFT}}', String(SAMPLE.daysLeft)).replaceAll('{{SUPPORT_URL}}', support)
  const expire = Math.floor(now() / MS_IN_SECOND) + SAMPLE.daysLeft * DAY_SECONDS
  const lines: readonly (readonly [string, string])[] = [
    ['Profile-Title', title || words.omitted],
    ['Profile-Update-Interval', draft.interval.trim()],
    ['Support-URL', support || words.omitted],
    ['Announce', announce || words.omitted],
    ['Subscription-Userinfo', `upload=0; download=${SAMPLE.usedBytes}; total=${SAMPLE.totalBytes}; expire=${expire}`],
  ]
  return (
    <div className={styles.sample}>
      {lines.map(([name, value]) => (
        <span key={name} className={styles.sampleLine}>
          <span className={styles.sampleName}>{name}: </span>
          {value}
        </span>
      ))}
    </div>
  )
}

function ProbeResult({ result }: { result: SubscriptionProbe }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const verdict = probeVerdict(result)
  const title = verdict === 'ok' ? words.probeOk : verdict === 'notRoute' ? words.probeNotRoute : words.probeBad
  return (
    <>
      <p className={verdict === 'ok' ? styles.ok : styles.danger}>{title}</p>
      <p className={styles.note}>{words.probeFacts(result.status === 0 ? '-' : String(result.status), result.ms, result.tlsExpiresAt ? fmtDate(result.tlsExpiresAt, locale) : '-', result.url)}</p>
      {result.error && <p className={styles.danger}>{result.error}</p>}
    </>
  )
}

function PagePreview() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [state, setState] = useState<PreviewState>('active')
  const preview = usePreviewUrl(state, locale)
  const view = previewView(preview)
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.previewTitle}</h2>
      <div className={styles.chips} role="group" aria-label={words.previewStateLabel}>
        {PREVIEW_STATES.map((s) => (
          <Chip key={s} label={words.previewState[s]} active={state === s} onClick={() => setState(s)} />
        ))}
      </div>
      {view === 'loading' && <QueryLoading label={words.loading} />}
      {view === 'failed' && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void preview.refetch()}>
          {preview.isError ? `${words.previewFailed} ${failureText(preview.error, locale)}` : words.previewFailed}
        </QueryFailedLine>
      )}
      {view === 'ready' && preview.data && (
        <>
          <iframe key={preview.data.url} className={styles.frame} src={previewPath(preview.data.url)} title={words.previewTitle} />
          <a className={styles.link} href={previewPath(preview.data.url)} target="_blank" rel="noopener noreferrer">
            {words.previewOpen}
          </a>
        </>
      )}
      <p className={styles.note}>{words.previewHint}</p>
    </section>
  )
}

function Form({ settings }: { settings: AdminSettings }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const save = useSaveSettings()
  const probe = useProbeAddress()
  const [initial, setInitial] = useState<ParamsDraft>(() => draftOfSettings(settings))
  const [draft, setDraft] = useState<ParamsDraft>(initial)
  const [failure, setFailure] = useState<string | null>(null)
  const [lang, setLang] = useState<'ru' | 'en'>(locale)
  const announceRef = useRef<HTMLTextAreaElement>(null)
  const patch = (next: Partial<ParamsDraft>) => {
    setFailure(null)
    setDraft((d) => ({ ...d, ...next }))
  }
  const supportOk = supportUrlValid(draft.supportUrl)
  const intervalOk = intervalValid(draft.interval)
  const canBuild = supportOk && intervalOk
  const body = canBuild ? paramsBody(initial, draft) : null
  const dirty = body === null || Object.keys(body).length > 0
  const hostChanged = draft.publicHost.trim() !== initial.publicHost.trim()
  const active = activeCountOf(settings)
  const formats: readonly SubscriptionFormat[] = DEFAULT_FORMAT_NAMES
  const send = () => {
    if (!body) return
    setFailure(null)
    save.mutate(body, {
      onSuccess: () => {
        setInitial(draft)
        toast.show(words.saved)
      },
      onError: (err) => setFailure(failureText(err, locale)),
    })
  }
  /** Drop a placeholder at the caret: a wrong brace ships a literal {{DAYS_LEFT}} to every client. */
  const insert = (token: string) => {
    const el = announceRef.current
    const start = el?.selectionStart ?? draft.announce.length
    const end = el?.selectionEnd ?? start
    patch({ announce: draft.announce.slice(0, start) + token + draft.announce.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const setDead = (key: DeadTextState, value: string) => patch({ dead: { ...draft.dead, [key]: { ...draft.dead[key], [lang]: value } } })
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{words.paramsTitle}</h1>
        <div className={styles.actions}>
          <span className={styles.note}>{words.appliesOnFetch}</span>
          <Button disabled={!dirty} onClick={() => setDraft(initial)}>
            {words.reset}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty || !canBuild} onClick={send}>
            {words.save}
          </Button>
        </div>
      </div>
      {failure && <Banner tone="danger">{failure}</Banner>}
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.clientTitle}</h2>
            <Field label={words.profileTitle} hint={words.profileTitleHint}>{(a11y) => <Input {...a11y} placeholder={settings.brandName ?? ''} value={draft.profileTitle} onChange={(e) => patch({ profileTitle: e.target.value })} />}</Field>
            <div className={styles.twoFields}>
              <Field label={words.interval} hint={words.intervalHint} error={intervalOk ? undefined : words.intervalBad}>{(a11y) => <Input {...a11y} inputMode="numeric" value={draft.interval} onChange={(e) => patch({ interval: e.target.value })} />}</Field>
              <Field label={words.supportUrl} hint={words.supportUrlHint} error={supportOk ? undefined : words.supportUrlBad}>{(a11y) => <Input {...a11y} placeholder="https://t.me/your_support" value={draft.supportUrl} onChange={(e) => patch({ supportUrl: e.target.value })} />}</Field>
            </div>
            <Field label={words.announce} hint={words.announceHint}>{(a11y) => <textarea {...a11y} ref={announceRef} className={styles.area} rows={3} value={draft.announce} onChange={(e) => patch({ announce: e.target.value })} />}</Field>
            <div className={styles.chips}>
              {PLACEHOLDERS.map((token) => (
                <Button key={token} size="sm" aria-label={words.insertPlaceholder(token)} onClick={() => insert(token)}>
                  {token}
                </Button>
              ))}
            </div>
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.formatTitle}</h2>
            <p className={styles.note}>{words.formatHint}</p>
            <Select aria-label={words.formatTitle} value={draft.format} onChange={(e) => patch({ format: e.target.value as SubscriptionFormat })} options={formats.map((f) => ({ value: f, label: words.formatNames[f] ?? f }))} />
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.shapeTitle}</h2>
            <p className={styles.note}>{words.shapeHint}</p>
            <RadioRow name="shape" title={words.shapePerNode} description={words.shapePerNodeNote} checked={draft.shape === 'per-node'} onSelect={() => patch({ shape: 'per-node' })} />
            <RadioRow name="shape" title={words.shapePerExit} description={words.shapePerExitNote} checked={draft.shape === 'per-exit'} onSelect={() => patch({ shape: 'per-exit' })} />
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.addressTitle}</h2>
            <p className={styles.note}>{words.addressHint}</p>
            <div className={styles.twoFields}>
              <Field label={words.publicHost}>{(a11y) => <Input {...a11y} placeholder="sub.example.com" value={draft.publicHost} onChange={(e) => patch({ publicHost: e.target.value })} />}</Field>
              <Field label={words.pathPrefix} hint={words.pathPrefixWhy}>{(a11y) => <Input {...a11y} readOnly value={settings.subscriptionPathPrefix ?? '/sub'} />}</Field>
            </div>
            {hostChanged && active === null && <p className={styles.amber}>{words.activeUnknown}</p>}
            {hostChanged && active !== null && active > 0 && <Banner tone="warn">{words.activeWarn(fmtNumber(active, locale))}</Banner>}
            <div className={styles.actions}>
              <Button size="sm" loading={probe.isPending} onClick={() => probe.mutate()}>
                {words.probe}
              </Button>
              {!probe.data && !probe.isError && <span className={styles.note}>{words.probeNone}</span>}
            </div>
            {hostChanged && <p className={styles.note}>{words.probeUnsaved}</p>}
            {probe.isError && <p className={styles.danger}>{`${words.probeFailed}: ${failureText(probe.error, locale)}`}</p>}
            {probe.data && <ProbeResult result={probe.data} />}
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.presetTitle}</h2>
            <p className={styles.note}>
              {words.presetHint} <Link className={styles.link} to="/routes">{words.presetEdit}</Link>
            </p>
            {ROUTING_PRESET_IDS.map((id: RoutingPresetId) => (
              <RadioRow key={id} name="preset" title={words.presets[id]?.title ?? id} description={words.presets[id]?.hint ?? ''} checked={draft.preset === id} onSelect={() => patch({ preset: id })} />
            ))}
          </section>
          <section className={styles.panel}>
            <Switch label={words.fragmentTitle} checked={draft.tlsFragment} onChange={(tlsFragment) => patch({ tlsFragment })} />
            <p className={styles.note}>{words.fragmentHint}</p>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{words.deadTitle}</h2>
              <Segmented<'ru' | 'en'> label={words.langLabel} value={lang} onChange={setLang} options={[{ value: 'ru', label: 'RU' }, { value: 'en', label: 'EN' }]} />
            </div>
            <p className={styles.note}>{words.deadHint}</p>
            {DEAD_STATES.map((key) => (
              <Field key={key} label={words.dead[key]}>{(a11y) => <textarea {...a11y} className={styles.area} rows={2} placeholder={words.deadDefault[key]} value={draft.dead[key]?.[lang] ?? ''} onChange={(e) => setDead(key, e.target.value)} />}</Field>
            ))}
          </section>
        </div>
        <div className={styles.right}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.headersTitle}</h2>
            <HeaderSample draft={draft} brandName={settings.brandName ?? ''} />
            <p className={styles.note}>{words.headersHint}</p>
          </section>
          <PagePreview />
        </div>
      </div>
    </div>
  )
}

export default function ParamsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const settings = useSettings()
  if (settings.isError) return <QueryFailed title={words.paramsFailed} body={failureText(settings.error, locale)} retryLabel={words.retry} onRetry={() => void settings.refetch()} />
  if (!settings.data) return <QueryLoading label={words.loading} />
  return <Form settings={settings.data} />
}
