import { useState } from 'react'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useSaveSettings, useSettings } from '@/contours/traffic/hooks/useRoutes'
import { draftOfOwn, listProblems, ownBody, type OwnDraft } from '@/contours/traffic/lib/ownLists'
import { parseRules } from '@/contours/traffic/lib/routeExchange'
import { DICT, sayer } from '@/contours/traffic/routesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { AdminSettings } from '@/lib/old/settings'
import { Button } from '@/ui/Button/Button'
import { Field } from '@/ui/Field/Field'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

function Bucket({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const words = useDict(DICT)
  const problems = listProblems(value)
  const first = problems[0]
  return (
    <Field label={label} error={first ? words.lineProblem[first.problem](first.line) : undefined}>
      {(a11y) => <textarea {...a11y} className={styles.area} rows={6} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

function Form({ settings }: { settings: AdminSettings }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const save = useSaveSettings()
  const say = sayer(words)
  const [stored, setStored] = useState<OwnDraft>(() => draftOfOwn(settings))
  const [draft, setDraft] = useState<OwnDraft>(stored)
  const [failure, setFailure] = useState<string | null>(null)
  const rules = parseRules(draft.rules)
  const hasProblem = [draft.direct, draft.proxy, draft.block].some((text) => listProblems(text).length > 0) || rules.error !== null
  const body = ownBody(stored, draft)
  const untouched = Object.keys(body).length === 0
  const patch = (next: Partial<OwnDraft>) => {
    setFailure(null)
    setDraft((d) => ({ ...d, ...next }))
  }
  const send = () => {
    setFailure(null)
    save.mutate(body, {
      onSuccess: () => {
        setStored(draft)
        toast.show(words.ownSaved)
      },
      onError: (err) => setFailure(failureText(err, locale)),
    })
  }
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{words.ownTitle}</h2>
          <p className={styles.note}>{words.ownHint}</p>
        </div>
        <Button variant="primary" loading={save.isPending} disabled={untouched || hasProblem} onClick={send}>
          {words.save}
        </Button>
      </div>
      {failure && <p className={styles.danger}>{failure}</p>}
      <div className={styles.buckets}>
        <Bucket label={words.bucketDirect} value={draft.direct} onChange={(direct) => patch({ direct })} />
        <Bucket label={words.bucketProxy} value={draft.proxy} onChange={(proxy) => patch({ proxy })} />
        <Bucket label={words.bucketBlock} value={draft.block} onChange={(block) => patch({ block })} />
      </div>
      <p className={styles.note}>{words.bareName}</p>
      <Field label={words.rawRules} hint={words.rawRulesHint} error={rules.error ? say(rules.error) : undefined}>
        {(a11y) => <textarea {...a11y} className={styles.area} rows={6} spellCheck={false} placeholder='[ { "type": "field", "domain": ["geosite:category-ru"], "outboundTag": "direct" } ]' value={draft.rules} onChange={(e) => patch({ rules: e.target.value })} />}
      </Field>
    </section>
  )
}

/** The only stored part of on-device routing: emitted before the preset, which is why it stands under it, said out loud. */
export function OwnRules() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const settings = useSettings()
  if (settings.isError) {
    return (
      <QueryFailedLine retryLabel={words.retry} onRetry={() => void settings.refetch()}>
        {`${words.ownFailed}: ${failureText(settings.error, locale)}`}
      </QueryFailedLine>
    )
  }
  return settings.data ? <Form settings={settings.data} /> : null
}
