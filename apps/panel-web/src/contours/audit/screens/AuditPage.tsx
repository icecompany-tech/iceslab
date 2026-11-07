import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS, type AdminAuditEventDto, type AdminAuditTargetKind } from '@iceslab/shared'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import styles from '@/contours/audit/components/audit.module.css'
import { DICT } from '@/contours/audit/dict'
import { ACTION_GROUPS, actionFilterParam, actionWords, actorWords, detailLines, groupValue, isLoginSummary, outcomeWords, periodFrom, targetWords } from '@/contours/audit/lib/auditWords'
import { useNow } from '@/lib/clock'
import { fmtDateTime } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { auditRefusal, listAudit } from '@/lib/old/audit'
import { Button } from '@/ui/Button/Button'
import { Field } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

const PAGE = 50
const PERIODS = { day: 1, week: 7, month: 30, all: null } as const
type Period = keyof typeof PERIODS

function Row({ event, open, onToggle }: { event: AdminAuditEventDto; open: boolean; onToggle: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const lines = open ? detailLines(event, words, (iso) => fmtDateTime(iso, locale)) : []
  const tone = event.outcome === 'ok' ? styles.outcomeOk : event.outcome === 'refused' ? styles.outcomeRefused : styles.outcomeFailed
  return (
    <Fragment>
      <tr className={styles.row} onClick={onToggle}>
        <td className={styles.when}>
          <button type="button" className={styles.rowButton} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle() }}>
            {fmtDateTime(event.at, locale)}
          </button>
        </td>
        <td>{actorWords(event, words)}</td>
        <td>{actionWords(event.action, words)}</td>
        <td>{targetWords(event, words)}</td>
        <td className={tone}>{outcomeWords(event, words)}</td>
      </tr>
      {open && (
        <tr className={styles.detail}>
          <td colSpan={5}>
            <ul className={styles.lines}>
              {(lines.length > 0 ? lines : [words.none]).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {isLoginSummary(event) && <p className={styles.note}>{words.loginSummaryWhy}</p>}
          </td>
        </tr>
      )}
    </Fragment>
  )
}

export default function AuditPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const [action, setAction] = useState('')
  const [targetKind, setTargetKind] = useState<AdminAuditTargetKind | ''>('')
  // Fixed when the period is picked: computed on render it would change the key on every render and refetch for ever.
  const [period, setPeriod] = useState<{ name: Period; from: string | undefined }>(() => ({ name: 'week', from: periodFrom(PERIODS.week, now()) }))
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const filters = { ...(actionFilterParam(action) ? { action: actionFilterParam(action) } : {}), ...(targetKind ? { targetKind } : {}), ...(period.from ? { from: period.from } : {}) }
  const filtered = Object.keys(filters).length > 0
  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => listAudit({ ...filters, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const events = query.data?.pages.flatMap((p) => p.events) ?? []
  const refusal = auditRefusal(query.error)
  const active = (action ? 1 : 0) + (targetKind ? 1 : 0)
  const failureWords = refusal === 'BAD_CURSOR' ? words.badCursor : failureText(query.error, locale)
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h1 className={styles.pageTitle}>{words.title}</h1>
          <p className={styles.note}>{words.subtitle}</p>
        </div>
        <div className={styles.actions}>
          <Popover
            align="end"
            trigger={(props) => (
              <Button {...props} size="sm" icon={<Icon name="filter" size="md" />}>
                {active > 0 ? `${words.filters}: ${active}` : words.filters}
              </Button>
            )}
          >
            <div className={styles.filters}>
              <Field label={words.filterAction}>
                {(a11y) => <Select {...a11y} look="filter" value={action} onChange={(e) => setAction(e.target.value)} options={[{ value: '', label: words.allActions }, ...ACTION_GROUPS.map((g) => ({ value: groupValue(g), label: words.groupOf(words.group[g] ?? g) })), ...ADMIN_AUDIT_ACTIONS.map((a) => ({ value: a, label: actionWords(a, words) }))]} />}
              </Field>
              <Field label={words.filterTarget}>
                {(a11y) => <Select {...a11y} look="filter" value={targetKind} onChange={(e) => setTargetKind(e.target.value as AdminAuditTargetKind | '')} options={[{ value: '', label: words.allTargets }, ...ADMIN_AUDIT_TARGET_KINDS.map((k) => ({ value: k, label: words.target[k] ?? k }))]} />}
              </Field>
              <Button
                size="sm"
                onClick={() => {
                  setAction('')
                  setTargetKind('')
                }}
              >
                {words.filterReset}
              </Button>
            </div>
          </Popover>
          <Segmented<Period> label={words.periodLabel} value={period.name} onChange={(name) => setPeriod({ name, from: periodFrom(PERIODS[name], now()) })} options={(Object.keys(PERIODS) as Period[]).map((p) => ({ value: p, label: words.period[p] }))} />
        </div>
      </div>
      {query.isPending && <QueryLoading label={words.loading} />}
      {query.isError && !query.data && refusal === 'AUDIT_ADMIN_ONLY' && <div className={styles.empty}>{words.adminOnly}</div>}
      {query.isError && !query.data && refusal !== 'AUDIT_ADMIN_ONLY' && <QueryFailed title={words.failedTitle} body={failureWords} retryLabel={refusal === 'BAD_CURSOR' ? words.reopen : words.retry} onRetry={() => void query.refetch()} />}
      {query.data && events.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{filtered ? words.emptyFiltered : words.empty}</h2>
          {!filtered && <p>{words.emptyBody}</p>}
        </div>
      )}
      {events.length > 0 && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.colAt}</th>
                <th scope="col">{words.colActor}</th>
                <th scope="col">{words.colAction}</th>
                <th scope="col">{words.colTarget}</th>
                <th scope="col">{words.colOutcome}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <Row key={event.id} event={event} open={open.has(event.id)} onToggle={() => toggle(event.id)} />
              ))}
            </tbody>
          </table>
          <div className={styles.foot}>
            {query.hasNextPage ? (
              <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {words.more}
              </Button>
            ) : (
              <span className={styles.note}>{words.end}</span>
            )}
            {query.isFetchNextPageError && <p className={styles.danger}>{failureWords}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
