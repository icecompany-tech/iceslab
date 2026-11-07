import { useState } from 'react'
import styles from '@/contours/subscription/components/subscription.module.css'
import { DICT } from '@/contours/subscription/dict'
import { useSaveRule, useTemplates } from '@/contours/subscription/hooks/useSubscription'
import { draftOfRule, priorityValid, ruleCreateBody, ruleUpdateBody, type RuleDraft } from '@/contours/subscription/lib/srrBody'
import { CASCADE_AWARE_FORMATS, SRR_FORMATS } from '@/contours/subscription/lib/srrFormats'
import { compilePattern, isCatchAll, patternCompiles, shadowedBy } from '@/contours/subscription/lib/srrMatch'
import { srrTemplateChoices } from '@/contours/subscription/lib/srrTemplate'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'
import { srrTemplateRefusal, type SrrRule, type SrrTemplateRefusal, type SubscriptionFormat } from '@/lib/old/srr'
import { isNotImplemented } from '@/lib/old/subscriptionTemplates'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'
import { useToast } from '@/ui/Toast/useToast'

const UA_MAX = 256
const DEFAULT_TEMPLATE = ''

export interface RuleWindowProps {
  rule: SrrRule | null
  rules: readonly SrrRule[]
  onClose: () => void
}

/** A rule is edited in a window over the table (F-V1), the refusals at their fields; the form stays. */
export function RuleWindow({ rule, rules, onClose }: RuleWindowProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const save = useSaveRule(rule?.id ?? null)
  const templates = useTemplates()
  const [draft, setDraft] = useState<RuleDraft>(() => draftOfRule(rule, rules))
  const [sample, setSample] = useState('')
  const [nameTaken, setNameTaken] = useState(false)
  const [templateRefused, setTemplateRefused] = useState<SrrTemplateRefusal | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const patch = (next: Partial<RuleDraft>) => {
    setFailure(null)
    setNameTaken(false)
    setTemplateRefused(null)
    setDraft((d) => ({ ...d, ...next }))
  }
  const nameOk = draft.name.trim() !== ''
  const patternOk = patternCompiles(draft.uaPattern)
  const priorityOk = priorityValid(draft.priority)
  const valid = nameOk && patternOk && priorityOk
  const body = rule && valid ? ruleUpdateBody(rule, draft) : null
  const untouched = rule !== null && body !== null && Object.keys(body).length === 0
  const priority = Number(draft.priority.trim())
  const templatesKnown = rule ? rule.templateName !== undefined : rules.every((r) => r.templateName !== undefined)
  const { takesTemplate, names } = srrTemplateChoices(draft.format, templates.data?.templates ?? [], draft.templateName)
  const formats: readonly SubscriptionFormat[] = SRR_FORMATS.includes(draft.format) ? SRR_FORMATS : [...SRR_FORMATS, draft.format]
  const formatName = (f: string) => words.formatNames[f] ?? f

  const typed = sample.trim()
  const hits = typed !== '' && patternOk && (compilePattern(draft.uaPattern)?.test(typed.slice(0, UA_MAX)) ?? false)
  const shadow = valid ? shadowedBy([...rules], { uaPattern: draft.uaPattern, priority, enabled: draft.enabled }, typed, rule?.id) : null
  const tie = rules.find((r) => r.id !== rule?.id && r.enabled && r.priority === priority) ?? null

  const send = () => {
    setFailure(null)
    const input = rule ? (body ?? {}) : ruleCreateBody(draft)
    save.mutate(input, {
      onSuccess: () => {
        toast.show(rule ? words.ruleSaved : words.ruleCreated)
        onClose()
      },
      onError: (err) => {
        const refused = srrTemplateRefusal(err)
        if (refused) {
          setTemplateRefused(refused)
          return
        }
        if (isApiError(err) && err.status === 409) {
          setNameTaken(true)
          return
        }
        setFailure(failureText(err, locale))
      },
    })
  }

  const templateError = templateRefused ? (templateRefused.code === 'SRR_TEMPLATE_NOT_FOR_FORMAT' ? words.templateNotForFormat(formatName(draft.format), draft.templateName ?? '') : words.templateNotFound(draft.templateName ?? '')) : undefined
  return (
    <Dialog
      title={rule ? words.ruleEdit(rule.name) : words.ruleNew}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid || untouched} onClick={send}>
            {rule ? words.save : words.create}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        {failure && <Banner tone="danger">{failure}</Banner>}
        <div className={styles.twoFields}>
          <Field label={words.fieldName} hint={words.fieldNameHint} error={nameTaken ? words.nameTaken : nameOk || (rule === null && draft.name === '') ? undefined : words.nameRequired}>{(a11y) => <Input {...a11y} autoFocus={rule === null} placeholder="Happ" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
          <Field label={words.fieldPriority} hint={words.fieldPriorityHint} error={priorityOk ? undefined : words.priorityBad}>{(a11y) => <Input {...a11y} inputMode="numeric" value={draft.priority} onChange={(e) => patch({ priority: e.target.value })} />}</Field>
        </div>
        <Field label={words.fieldPattern} hint={words.fieldPatternHint} error={draft.uaPattern.length > 0 && !patternOk ? words.patternBad : undefined}>{(a11y) => <Input {...a11y} placeholder="(?i)happ" value={draft.uaPattern} onChange={(e) => patch({ uaPattern: e.target.value })} />}</Field>
        {isCatchAll(draft.uaPattern) && <p className={styles.amber}>{words.catchAllWarn}</p>}
        <Switch label={words.fieldEnabled} checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
        <Field label={words.fieldFormat} hint={words.formatAbout[draft.format]}>{(a11y) => <Select {...a11y} value={draft.format} onChange={(e) => patch({ format: e.target.value as SubscriptionFormat })} options={formats.map((f) => ({ value: f, label: formatName(f) }))} />}</Field>
        {CASCADE_AWARE_FORMATS.includes(draft.format) && <p className={styles.note}>{words.keepsExits}</p>}
        {templatesKnown && !isNotImplemented(templates.error) && (
          <>
            <Field label={words.fieldTemplate} error={templateError} hint={takesTemplate ? words.fieldTemplateHint : words.templateNoneForFormat(formatName(draft.format))}>
              {(a11y) => <Select {...a11y} disabled={!takesTemplate && draft.templateName === null} value={draft.templateName ?? DEFAULT_TEMPLATE} onChange={(e) => patch({ templateName: e.target.value === DEFAULT_TEMPLATE ? null : e.target.value })} options={[{ value: DEFAULT_TEMPLATE, label: words.templateDefault }, ...names.map((n) => ({ value: n, label: n }))]} />}
            </Field>
            {templates.isError && (
              <QueryFailedLine retryLabel={words.retry} onRetry={() => void templates.refetch()}>
                {words.templatesFailed}
              </QueryFailedLine>
            )}
          </>
        )}
        <Field label={words.tryTitle}>{(a11y) => <Input {...a11y} placeholder="Happ/1.42.0 (iPhone; iOS 18.2)" value={sample} onChange={(e) => setSample(e.target.value)} />}</Field>
        {typed !== '' && patternOk && <p className={hits ? styles.ok : styles.note}>{hits ? words.tryHit : words.tryMiss}</p>}
        {shadow && <p className={styles.amber}>{words.overlapShadowed(shadow.priority, shadow.name, shadow.uaPattern)}</p>}
        {!shadow && hits && <p className={styles.note}>{words.overlapClear}</p>}
        {tie && priorityOk && <p className={styles.amber}>{words.overlapTie(tie.name, priority)}</p>}
        <p className={styles.note}>{words.scopeNote}</p>
      </div>
    </Dialog>
  )
}
