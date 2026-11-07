import { templateTypeForFormat } from '@iceslab/shared'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/subscription/components/subscription.module.css'
import { DICT } from '@/contours/subscription/dict'
import { useImportTemplate, useRules, useTemplates } from '@/contours/subscription/hooks/useSubscription'
import { importFacts, templatesScreenFacts } from '@/contours/subscription/lib/templateFacts'
import { fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { isNotImplemented, templateFormat, type SubscriptionTemplate } from '@/lib/old/subscriptionTemplates'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'

function ImportWindow({ onClose }: { onClose: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const parse = useImportTemplate()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    if (!file) return
    setError(null)
    const body = await file.text()
    parse.mutate(body, {
      onSuccess: (result) => {
        const imported = importFacts(result)
        if (!imported) {
          setError(words.importNoTemplate)
          return
        }
        // A draft, not a saved template: importing starts an edit, and the file's name reminds where it came from.
        void navigate('/subscription/templates/new', { state: { imported: { ...imported, name: imported.name || file.name.replace(/\.[^.]+$/, '') } } })
      },
      onError: (err) => setError(failureText(err, locale)),
    })
  }
  return (
    <Dialog
      title={words.importTitle}
      closeLabel={words.close}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={parse.isPending} disabled={!file} onClick={() => void send()}>
            {words.importGo}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <p>{words.importBody}</p>
        <input className={styles.fileInput} type="file" aria-label={words.importField} accept=".yaml,.yml,.json,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className={styles.note}>{words.migrateHint}</p>
        {error && <p className={styles.danger}>{error}</p>}
      </div>
    </Dialog>
  )
}

export default function TemplatesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const query = useTemplates()
  const rules = useRules()
  const [importing, setImporting] = useState(false)
  const facts = templatesScreenFacts({ ...(query.data ? { templates: query.data.templates } : {}), notImplemented: isNotImplemented(query.error), failed: query.isError })
  const closed = facts.state === 'unavailable' || facts.state === 'failed'
  const usedBy = (t: SubscriptionTemplate) => {
    if (!rules.data) return words.rulesUnknown
    const n = rules.data.rules.filter((r) => templateTypeForFormat(r.format) === t.type && (t.isDefault ? (r.templateName ?? null) === null : r.templateName === t.name)).length
    return words.rulesUsing(n)
  }
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{words.templatesTitle}</h1>
        <div className={styles.actions}>
          <Button disabled={closed} onClick={() => setImporting(true)}>
            {words.templateImport}
          </Button>
          {!closed && (
            <Link className={styles.linkPrimary} to="/subscription/templates/new">
              <Icon name="plus" size="md" />
              {words.templateCreate}
            </Link>
          )}
        </div>
      </div>
      {facts.state === 'loading' && <QueryLoading label={words.loading} />}
      {facts.state === 'failed' && <QueryFailed title={words.templatesLoadFailed} body={failureText(query.error, locale)} retryLabel={words.retry} onRetry={() => void query.refetch()} />}
      {facts.state === 'unavailable' && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.templatesAbsent}</h2>
          <p>{words.templatesAbsentBody}</p>
        </div>
      )}
      {facts.state === 'empty' && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.templatesEmpty}</h2>
          <p>{words.templatesEmptyBody}</p>
        </div>
      )}
      {facts.groups.map((group) => (
        <section key={group.type} className={styles.group}>
          <div className={styles.groupHead}>
            {group.type}
            <span className={styles.note}>{words.serves(templateFormat(group.type))}</span>
          </div>
          {group.templates.map((t) => (
            <Link key={t.id} className={styles.templateRow} to={`/subscription/templates/${t.id}`}>
              <span>{t.name}</span>
              {t.isDefault && <span className={styles.tag}>{words.defaultTag}</span>}
              <span className={styles.spacer} />
              <span className={styles.note}>{usedBy(t)}</span>
              <span className={styles.note}>{words.edited(fmtDateTime(t.updatedAt, locale))}</span>
            </Link>
          ))}
        </section>
      ))}
      {importing && <ImportWindow onClose={() => setImporting(false)} />}
    </div>
  )
}
