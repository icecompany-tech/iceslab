import { useState } from 'react'
import { RegionsCard } from '@/contours/settings/components/RegionsCard'
import { SourcesCard } from '@/contours/settings/components/SourcesCard'
import styles from '@/contours/settings/components/settings.module.css'
import { DICT } from '@/contours/settings/dict'
import { useSaveSettings, useSettings, useVersion } from '@/contours/settings/hooks/useSettingsData'
import { brandBody } from '@/contours/settings/lib/regionBody'
import { useDict, useLocale, type Locale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { useToast } from '@/ui/Toast/useToast'

function BrandField({ stored }: { stored: string }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const save = useSaveSettings()
  const [saved, setSaved] = useState(stored)
  const [typed, setTyped] = useState(stored)
  const [touched, setTouched] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const body = brandBody(saved, typed)
  const send = () => {
    if (!body) return
    setFailure(null)
    save.mutate(body, {
      onSuccess: () => {
        setSaved(body.brandName)
        toast.show(words.saved)
      },
      onError: (err) => setFailure(failureText(err, locale)),
    })
  }
  return (
    <>
      <div className={styles.saveRow}>
        {/* The refusal only after an edit: a panel without its own name seeds the field empty. */}
        <Field label={words.brandName} hint={words.brandHint} error={touched && typed.trim() === '' ? words.brandEmpty : undefined}>
          {(a11y) => (
            <Input
              {...a11y}
              placeholder="Iceslab"
              value={typed}
              onChange={(e) => {
                setTouched(true)
                setFailure(null)
                setTyped(e.target.value)
              }}
            />
          )}
        </Field>
        <Button variant="primary" loading={save.isPending} disabled={!body} onClick={send}>
          {words.save}
        </Button>
      </div>
      {failure && <p className={styles.danger}>{failure}</p>}
    </>
  )
}

function PanelCard() {
  const words = useDict(DICT)
  const { locale, setLocale } = useLocale()
  const settings = useSettings()
  const save = useSaveSettings()
  const [langFailed, setLangFailed] = useState(false)
  const pick = (next: Locale) => {
    setLocale(next)
    setLangFailed(false)
    // The switch here does not wait for the server: a failed store is said, not blocking.
    save.mutate({ defaultLocale: next }, { onError: () => setLangFailed(true) })
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.panelTitle}</h2>
      {settings.isPending && <QueryLoading label={words.loading} />}
      {/* Without the answer the field stays out: empty, a save would write over the operator's own name. */}
      {settings.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void settings.refetch()}>
          {`${words.settingsFailed}: ${failureText(settings.error, locale)}`}
        </QueryFailedLine>
      )}
      {settings.data && <BrandField stored={settings.data.brandName ?? ''} />}
      <Segmented<Locale> label={words.language} value={locale} onChange={pick} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
      <p className={styles.note}>{words.languageHint}</p>
      {langFailed && <p className={styles.amber}>{words.languageFailed}</p>}
    </section>
  )
}

function AboutCard() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const version = useVersion()
  const data = version.data
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{words.aboutTitle}</h2>
      {version.isPending && <QueryLoading label={words.loading} />}
      {version.isError && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void version.refetch()}>
          {`${words.aboutFailed}: ${failureText(version.error, locale)}`}
        </QueryFailedLine>
      )}
      <dl className={styles.facts}>
        <dt>{words.versionUi}</dt>
        <dd>{__APP_VERSION__}</dd>
        {data && (
          <>
            <dt>{words.versionServer}</dt>
            <dd>{data.current}</dd>
            <dt>{words.versionLatest}</dt>
            <dd>{data.latest ?? words.versionLatestUnknown}</dd>
          </>
        )}
      </dl>
      {data && <p className={data.current === __APP_VERSION__ ? styles.note : styles.amber}>{data.current === __APP_VERSION__ ? words.versionsSame : words.versionsDiffer}</p>}
      {data?.updateAvailable && data.latest && (
        <p className={styles.amber}>
          {words.updateAvailable(data.latest)}{' '}
          {data.releaseUrl && (
            <a className={styles.link} href={data.releaseUrl} target="_blank" rel="noopener noreferrer">
              {words.releaseNotes}
            </a>
          )}
        </p>
      )}
    </section>
  )
}

export default function SettingsPage() {
  const words = useDict(DICT)
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{words.title}</h1>
      <div className={styles.columns}>
        <div className={styles.left}>
          <PanelCard />
          <RegionsCard />
          <SourcesCard />
        </div>
        <AboutCard />
      </div>
    </div>
  )
}
