import { templateTypeForFormat } from '@iceslab/shared'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import styles from '@/contours/subscription/components/subscription.module.css'
import { DICT } from '@/contours/subscription/dict'
import { runDryRun, useDeleteTemplate, useDryRun, useRestoreTemplate, useRules, useSaveTemplate, useTemplates } from '@/contours/subscription/hooks/useSubscription'
import { dryRunFacts, dryRunForBody, nodesInNoGroup, saveAfterRun, singleFlight, templateActions, templateEditGate, templateEditorFacts, templateSavePatch, type ImportFacts } from '@/contours/subscription/lib/templateFacts'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { isNotImplemented, TEMPLATE_TYPES, templateBodyLanguage, templateFormat, templateRefusal, type SubscriptionTemplate, type TemplateDryRun, type TemplateType } from '@/lib/old/subscriptionTemplates'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { CodeArea } from '@/ui/CodeArea/CodeArea'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

type Ask = 'restore' | 'delete' | null
const RENDERED_ROWS = 12

function Form({ template, imported }: { template: SubscriptionTemplate | null; imported: ImportFacts | null }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const isNew = template === null
  const [type, setType] = useState<TemplateType>(template?.type ?? imported?.type ?? 'mihomo')
  const [name, setName] = useState(template?.name ?? imported?.name ?? '')
  const [body, setBody] = useState(template?.body ?? imported?.body ?? '')
  const [stored, setStored] = useState<SubscriptionTemplate | null>(template)
  const [invalid, setInvalid] = useState<{ line: number | null; column: number | null; message: string } | null>(null)
  const [nameTaken, setNameTaken] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [run, setRun] = useState<TemplateDryRun | null>(null)
  const [ranForBody, setRanForBody] = useState<string | null>(null)
  const [once] = useState(() => singleFlight())
  const [ask, setAsk] = useState<Ask>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const dryRun = useDryRun()
  const save = useSaveTemplate(stored?.id ?? null, type)
  const restore = useRestoreTemplate(stored?.id ?? '')
  const remove = useDeleteTemplate(stored?.id ?? '')
  const rules = useRules()

  const dirty = isNew ? name.trim() !== '' || body.trim() !== '' : stored !== null && (name !== stored.name || body !== stored.body)
  const facts = templateEditorFacts({ isNew, isDefault: stored?.isDefault ?? false, name, body, dirty })
  const dry = dryRunFacts(dryRunForBody(run, ranForBody, body))
  const actions = templateActions({ isDefault: stored?.isDefault ?? false })
  const usedBy = rules.data && stored ? String(rules.data.rules.filter((r) => templateTypeForFormat(r.format) === stored.type && r.templateName === stored.name).length) : '?'

  const clear = () => {
    setInvalid(null)
    setNameTaken(false)
    setFailure(null)
  }
  const runNow = () => {
    clear()
    dryRun.mutate(
      { type, body },
      {
        onSuccess: (result) => {
          setRun(result)
          setRanForBody(body)
        },
        onError: (err) => setFailure(isNotImplemented(err) ? words.dryRunAbsent : `${words.dryRunFailed}: ${failureText(err, locale)}`),
      },
    )
  }
  const attemptSave = () => {
    if (dry && !dry.canSave) return
    clear()
    const bodyNow = body
    // One run and one save per press, a double click included.
    void once(async () => {
      try {
        const outcome = await saveAfterRun({
          shown: dryRunForBody(run, ranForBody, bodyNow),
          runDry: () => runDryRun({ type, body: bodyNow }),
          onRun: (fresh) => {
            setRun(fresh)
            setRanForBody(bodyNow)
          },
          notImplemented: isNotImplemented,
          save: () => {
            const patch = templateSavePatch(stored, name, bodyNow) ?? {}
            return save.mutateAsync({ ...patch, fullName: name.trim(), fullBody: bodyNow })
          },
        })
        // Refused by the run: nothing went, the verdict and its reason are on screen.
        if (outcome.kind === 'refused') return
        const note = outcome.note === 'not-here' ? words.savedNoRunHere : outcome.note === 'no-answer' ? words.savedRunNoAnswer : words.saved
        toast.show(note, outcome.note ? 'partial' : 'done')
        if (isNew) void navigate(`/subscription/templates/${outcome.result.id}`, { replace: true })
        else setStored(outcome.result)
      } catch (err) {
        const refusal = templateRefusal(err)
        // A contract refusal stays at its place: the line by the body, a taken name by the name.
        if (refusal?.code === 'TEMPLATE_INVALID') setInvalid({ line: refusal.line ?? null, column: refusal.column ?? null, message: refusal.message ?? words.invalidNoMessage })
        else if (refusal?.code === 'TEMPLATE_NAME_TAKEN') setNameTaken(true)
        else if (refusal?.code === 'TEMPLATE_DEFAULT_PROTECTED') setFailure(words.defaultKeepsName)
        else setFailure(failureText(err, locale))
      }
    })
  }
  const confirmRestore = () => {
    setAskError(null)
    restore.mutate(undefined, {
      onSuccess: (fresh) => {
        setBody(fresh.body)
        setStored(fresh)
        setRun(null)
        setRanForBody(null)
        clear()
        setAsk(null)
        toast.show(words.restored)
      },
      onError: (err) => setAskError(templateRefusal(err)?.code === 'TEMPLATE_NOT_DEFAULT' ? words.notDefault : failureText(err, locale)),
    })
  }
  const confirmDelete = () => {
    setAskError(null)
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.show(words.templateDeleted)
        void navigate('/subscription/templates')
      },
      onError: (err) => setAskError(templateRefusal(err)?.code === 'TEMPLATE_DEFAULT_PROTECTED' ? words.defaultProtected : failureText(err, locale)),
    })
  }
  const lineWords = invalid ? (invalid.line && invalid.column ? words.invalidAtLineColumn(invalid.line, invalid.column) : invalid.line ? words.invalidAtLine(invalid.line) : words.invalid) : ''
  const verdictWords = dry?.verdict === 'checked' ? words.checkOk : dry?.verdict === 'unchecked' ? words.checkSkipped : words.checkFailed
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Link className={styles.link} to="/subscription/templates">
            {words.templatesTitle}
          </Link>
          <h1 className={styles.pageTitle}>{isNew ? words.templateNew : stored?.name}</h1>
          <span className={styles.note}>
            {words.serves(templateFormat(type))} · {templateBodyLanguage(type).toUpperCase()}
          </span>
        </div>
        <div className={styles.actions}>
          {facts.blocker === 'name' && <span className={styles.note}>{words.blockerName}</span>}
          {facts.blocker === 'body' && <span className={styles.note}>{words.blockerBody}</span>}
          {facts.blocker === null && dry?.verdict === 'refused' && <span className={styles.danger}>{words.blockerRefused}</span>}
          {!isNew && actions.canRestore && <Button onClick={() => setAsk('restore')}>{words.restoreAction}</Button>}
          {!isNew && actions.canDelete && (
            <Button variant="danger" onClick={() => setAsk('delete')}>
              {words.deleteAction}
            </Button>
          )}
          <Button loading={dryRun.isPending} disabled={body.trim() === ''} onClick={runNow}>
            {words.dryRun}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!facts.canSave || dryRun.isPending || dry?.canSave === false || (imported !== null && dry === null)} onClick={attemptSave}>
            {words.save}
          </Button>
        </div>
      </div>
      {!isNew && actions.protectedReason === 'default' && <p className={styles.note}>{words.defaultProtected}</p>}
      {failure && <Banner tone="danger">{failure}</Banner>}
      {imported && (
        <Banner tone="info">
          {words.migrateHint} {dry === null ? words.importNeedsDryRun : words.importReady} {imported.needsType ? words.importNeedsType : ''}
        </Banner>
      )}
      <section className={styles.panel}>
        <div className={styles.twoFields}>
          <Field label={words.type} hint={facts.canPickType ? words.typeHintNew : words.typeHintFixed}>{(a11y) => <Select {...a11y} disabled={!facts.canPickType} value={type} onChange={(e) => setType(e.target.value as TemplateType)} options={TEMPLATE_TYPES.map((t) => ({ value: t, label: t }))} />}</Field>
          <Field label={words.name} error={nameTaken ? words.templateNameTaken : undefined} hint={facts.canRename ? words.nameHint : words.nameDefaultLocked}>
            {(a11y) => (
              <Input
                {...a11y}
                disabled={!facts.canRename}
                value={name}
                onChange={(e) => {
                  setNameTaken(false)
                  setName(e.target.value)
                }}
              />
            )}
          </Field>
        </div>
        <CodeArea label={words.body} value={body} onChange={setBody} errorLine={invalid?.line ?? null} />
        {invalid && (
          <p className={styles.danger}>
            {lineWords} {invalid.message}
          </p>
        )}
        <p className={styles.note}>{words.bodyHint}</p>
      </section>
      {dry && (
        <section className={styles.panel}>
          <div className={styles.verdict}>
            <b className={dry.verdict === 'checked' ? styles.ok : dry.verdict === 'unchecked' ? styles.note : styles.danger}>{verdictWords}</b>
            {dry.check.message && <span className={styles.mono}>{dry.check.message}</span>}
          </div>
          {dry.warnings.length > 0 && (
            <Banner tone="warn" title={words.warnings}>
              {dry.warnings.map((w) => (
                <p key={w.message}>{w.message}</p>
              ))}
              <p>{words.warningsBlock}</p>
              {nodesInNoGroup(dry.warnings) && <p>{words.migrateHint}</p>}
            </Banner>
          )}
          <CodeArea label={words.rendered} value={dry.rendered} readOnly minRows={RENDERED_ROWS} />
          <p className={styles.note}>{words.renderedHint}</p>
        </section>
      )}
      {ask === 'restore' && (
        <Confirm title={words.restoreTitle} labels={{ confirm: words.restoreAction, cancel: words.cancel }} tone="warn" state={{ busy: restore.isPending, error: askError }} onConfirm={confirmRestore} onClose={() => setAsk(null)}>
          <p>{words.restoreBody}</p>
        </Confirm>
      )}
      {ask === 'delete' && (
        <Confirm title={words.deleteTemplateTitle(name)} labels={{ confirm: words.deleteAction, cancel: words.cancel }} tone="danger" state={{ busy: remove.isPending, error: askError }} onConfirm={confirmDelete} onClose={() => setAsk(null)}>
          <p>{words.deleteTemplateBody(usedBy)}</p>
        </Confirm>
      )}
    </div>
  )
}

function isImport(state: unknown): state is { imported: ImportFacts } {
  return typeof state === 'object' && state !== null && 'imported' in state
}

export default function TemplateEditPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const { id } = useParams()
  const { state } = useLocation()
  const query = useTemplates()
  const imported = isImport(state) ? state.imported : null
  const template = query.data?.templates.find((t) => t.id === id) ?? null
  const gate = templateEditGate(id === undefined, query, isNotImplemented(query.error), template !== null)
  switch (gate) {
    case 'failed':
      return <QueryFailed title={words.templatesLoadFailed} body={failureText(query.error, locale)} retryLabel={words.retry} onRetry={() => void query.refetch()} />
    case 'loading':
      return <QueryLoading label={words.loading} />
    case 'unavailable':
      return (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.templatesAbsent}</h2>
          <p>{words.templatesAbsentBody}</p>
        </div>
      )
    case 'gone':
      return (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.templateGone}</h2>
          <Link className={styles.link} to="/subscription/templates">
            {words.templateBack}
          </Link>
        </div>
      )
    case 'ready':
      return <Form key={id ?? 'new'} template={template} imported={imported} />
  }
}
