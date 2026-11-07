import { HWID_DEVICE_RETENTION_DAYS } from '@iceslab/shared'
import { Link } from 'react-router-dom'
import { BarRow } from '@/contours/insights/components/BarRow'
import styles from '@/contours/insights/components/insights.module.css'
import { DICT } from '@/contours/insights/dict'
import { useInsights } from '@/contours/insights/hooks/useInsights'
import { shareOf } from '@/contours/insights/lib/requests'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Banner } from '@/ui/Banner/Banner'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { StatCard } from '@/ui/StatCard/StatCard'

const SNAPSHOT_DAYS = 7
const AVG_DIGITS = 2

export default function DevicesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const query = useInsights(SNAPSHOT_DAYS)
  const data = query.data?.hwid
  const top = data ? Math.max(0, ...data.distribution.map((d) => d.users)) : 0
  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.pageTitle}>{words.devicesTitle}</h1>
        <p className={styles.note}>{words.devicesHint}</p>
      </div>
      {query.isPending && <QueryLoading label={words.loading} />}
      {query.isError && <QueryFailed title={words.failedTitle} body={failureText(query.error, locale)} retryLabel={words.retry} onRetry={() => void query.refetch()} />}
      {data && (
        <div className={styles.stats}>
          <StatCard label={words.statTracked} icon="phone" value={fmtNumber(data.totalDevices, locale)} />
          <StatCard label={words.statWithDevices} icon="users" value={fmtNumber(data.usersWithDevices, locale)} />
          <StatCard label={words.statAvg} icon="overview" value={data.avgDevicesPerUser.toFixed(AVG_DIGITS)} />
          <StatCard label={words.statAtLimit} icon="warn" value={fmtNumber(data.atOrOverLimit, locale)}>
            <p className={styles.note}>{words.limitNote}</p>
          </StatCard>
        </div>
      )}
      {data && data.atOrOverLimit > 0 && (
        <Banner tone="warn">
          {words.atLimit(data.atOrOverLimit)} {words.atLimitNote}
        </Banner>
      )}
      {data && data.totalDevices === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.noDevices}</h2>
          <p>{words.noDevicesBody}</p>
        </div>
      )}
      {data && data.totalDevices > 0 && (
        <div className={styles.columns}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.perUser}</h2>
            {data.distribution.map((d, i) => (
              <BarRow key={d.bucket} label={words.bucket(d.bucket)} value={words.usersCount(d.users)} percent={shareOf(d.users, top)} tone={i === data.distribution.length - 1 ? 'amber' : 'accent'} />
            ))}
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.howTitle}</h2>
            <p className={styles.note}>{words.how(HWID_DEVICE_RETENTION_DAYS)}</p>
            <Link className={styles.link} to="/users">
              {words.openUsers}
            </Link>
          </section>
        </div>
      )}
    </div>
  )
}
