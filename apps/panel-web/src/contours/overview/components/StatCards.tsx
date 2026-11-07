import { Link } from 'react-router-dom'
import styles from '@/contours/overview/components/blocks.module.css'
import { DICT } from '@/contours/overview/dict'
import { useExpiringSoon } from '@/contours/overview/hooks/useOverviewFacts'
import { nodeHealth, type Overview } from '@/lib/domain/overview'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { Icon } from '@/ui/Icon/Icon'
import { StatCard } from '@/ui/StatCard/StatCard'

export function StatCards({ overview }: { overview: Overview }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const expiring = useExpiringSoon()
  const n = (v: number) => fmtNumber(v, locale)
  const { users, system, nodes } = overview
  const problems = nodes.filter((node) => nodeHealth(node.status) === 'problem').length
  const unverified = nodes.filter((node) => nodeHealth(node.status) === 'unverified').length
  return (
    <div className={styles.cards}>
      <StatCard label={words.onlineNow} icon="wifi" value={n(users.onlineNow)}>
        <div className={styles.note}>{words.onlineToday(n(users.onlineToday))}</div>
      </StatCard>
      <StatCard label={words.activeUsers} icon="userCheck" value={users.byStatus.active === undefined ? words.unknown : n(users.byStatus.active)}>
        <div className={styles.note}>{words.totalUsers(n(users.total))}</div>
      </StatCard>
      <StatCard label={words.expiring} icon="calendarSoon" value={expiring.data === undefined ? words.unknown : n(expiring.data)}>
        {expiring.isError ? (
          <div className={styles.note}>{words.expiringFailed}</div>
        ) : (
          <Link className={styles.noteLink} to="/users?filter=expiring">
            {words.openList}
            <Icon name="arrowRight" size="sm" />
          </Link>
        )}
      </StatCard>
      <StatCard label={words.nodesOnline} icon="nodes" value={n(system.onlineNodeCount)} valueNote={words.ofTotal(n(system.totalNodeCount))}>
        <div className={styles.note}>
          {system.totalNodeCount === 0 ? (
            words.noNodes
          ) : problems === 0 && unverified === 0 ? (
            words.noProblems
          ) : (
            <>
              {problems > 0 && <span className={styles.danger}>{words.problemNodes(problems)}</span>}
              {problems > 0 && unverified > 0 && ', '}
              {unverified > 0 && words.unverifiedNodes(unverified)}
            </>
          )}
        </div>
      </StatCard>
    </div>
  )
}
