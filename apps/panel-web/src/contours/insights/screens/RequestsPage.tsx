import { useState } from 'react'
import { BarRow } from '@/contours/insights/components/BarRow'
import styles from '@/contours/insights/components/insights.module.css'
import { DICT } from '@/contours/insights/dict'
import { useInsights } from '@/contours/insights/hooks/useInsights'
import { perUserPerDay, shareOf, unknownClients } from '@/contours/insights/lib/requests'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { HourBars } from '@/ui/HourBars/HourBars'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { StatCard } from '@/ui/StatCard/StatCard'

type Window = '7' | '30' | '90'
const WINDOWS: readonly Window[] = ['7', '30', '90']
const CLIENTS_SHOWN = 8
const PER_DAY_DIGITS = 1

export default function RequestsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [windowDays, setWindowDays] = useState<Window>('7')
  const days = Number(windowDays)
  const query = useInsights(days)
  const data = query.data?.subRequests
  const leader = data?.byClient[0]?.count ?? 0
  const perDay = data ? perUserPerDay(data.total, data.uniqueUsers, days) : null
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h1 className={styles.pageTitle}>{words.requestsTitle}</h1>
          <p className={styles.note}>{words.requestsHint}</p>
        </div>
        <Segmented<Window> label={words.periodLabel} value={windowDays} onChange={setWindowDays} options={WINDOWS.map((w) => ({ value: w, label: words.days(Number(w)) }))} />
      </div>
      {query.isPending && <QueryLoading label={words.loading} />}
      {query.isError && <QueryFailed title={words.failedTitle} body={failureText(query.error, locale)} retryLabel={words.retry} onRetry={() => void query.refetch()} />}
      {data && (
        <div className={styles.stats}>
          <StatCard label={words.statRequests} icon="requests" value={fmtNumber(data.total, locale)} />
          <StatCard label={words.statUsers} icon="users" value={fmtNumber(data.uniqueUsers, locale)} />
          <StatCard label={words.statPerDay} icon="calendar" value={perDay === null ? '-' : perDay.toFixed(PER_DAY_DIGITS)} />
          <StatCard label={words.statUnknown} icon="warn" value={fmtNumber(unknownClients(data.byClient), locale)}>
            <p className={styles.note}>{words.unknownHint}</p>
          </StatCard>
        </div>
      )}
      {data && data.total === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.noRequests}</h2>
          <p>{words.noRequestsBody}</p>
        </div>
      )}
      {data && data.total > 0 && (
        <div className={styles.columns}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.byClient}</h2>
            {data.byClient.slice(0, CLIENTS_SHOWN).map((c) => (
              <BarRow key={c.client} label={c.client} value={fmtNumber(c.count, locale)} percent={shareOf(c.count, leader)} />
            ))}
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.byHour}</h2>
            <HourBars label={words.byHour} values={data.byHourUtc} title={words.hourTitle} />
          </section>
        </div>
      )}
    </div>
  )
}
