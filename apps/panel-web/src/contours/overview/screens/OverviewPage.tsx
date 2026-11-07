import { NodesBlock } from '@/contours/overview/components/NodesBlock'
import { ServerBlock } from '@/contours/overview/components/ServerBlock'
import { StatCards } from '@/contours/overview/components/StatCards'
import { TrafficBlock } from '@/contours/overview/components/TrafficBlock'
import { DICT } from '@/contours/overview/dict'
import styles from '@/contours/overview/screens/OverviewPage.module.css'
import { useOverview } from '@/lib/domain/overview'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'

export default function OverviewPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const overview = useOverview()
  if (overview.isPending) return <QueryLoading label={words.loading} />
  if (overview.isError) {
    return <QueryFailed title={words.failedTitle} body={failureText(overview.error, locale)} retryLabel={words.retry} onRetry={() => void overview.refetch()} />
  }
  const { data } = overview
  return (
    <div className={styles.page}>
      <StatCards overview={data} />
      <TrafficBlock traffic={data.traffic} />
      <ServerBlock host={data.host} checkedAt={overview.dataUpdatedAt} />
      <NodesBlock nodes={data.nodes} />
    </div>
  )
}
