import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/profiles/components/profiles.module.css'
import { DICT } from '@/contours/profiles/dict'
import { useAllBindings, useAllHosts, useProfilesList } from '@/contours/profiles/hooks/useProfiles'
import { engineLabel } from '@/lib/domain/engines'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

type View = 'cards' | 'list'

export default function ProfilesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const profiles = useProfilesList()
  const bindings = useAllBindings()
  const hosts = useAllHosts()
  const [view, setView] = useState<View>('cards')
  const [search, setSearch] = useState('')
  const [protocol, setProtocol] = useState('')
  const [noHostsOnly, setNoHostsOnly] = useState(false)

  // Hosts of a profile through its bindings. Unknown until both lists came: not "no hosts".
  const hostCount = useMemo(() => {
    if (!bindings.data || !hosts.data) return null
    const profileOf = new Map(bindings.data.bindings.map((b) => [b.id, b.profileId]))
    const counts = new Map<string, number>()
    for (const host of hosts.data.hosts) {
      const id = profileOf.get(host.bindingId)
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [bindings.data, hosts.data])

  const all = profiles.data?.profiles ?? []
  const countOf = (id: string) => (hostCount ? (hostCount.get(id) ?? 0) : null)
  const without = hostCount ? all.filter((p) => countOf(p.id) === 0).length : undefined
  const needle = search.trim().toLowerCase()
  const shown = all.filter((p) => (protocol === '' || p.protocol === protocol) && (!noHostsOnly || countOf(p.id) === 0) && (needle === '' || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(needle)))
  const protocols = [...new Set(all.map((p) => p.protocol))]

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Chip label={words.all} count={profiles.data ? all.length : undefined} active={!noHostsOnly} onClick={() => setNoHostsOnly(false)} />
          <Chip label={words.noHosts} count={without} dot="unknown" active={noHostsOnly} onClick={() => setNoHostsOnly(true)} />
        </div>
        <div className={styles.chips}>
          <Segmented<View> label={words.viewLabel} value={view} onChange={setView} options={[{ value: 'cards', label: words.views.cards }, { value: 'list', label: words.views.list }]} />
          <Link className={styles.linkPrimary} to="/profiles/new">
            <Icon name="plus" size="md" />
            {words.create}
          </Link>
        </div>
      </div>
      <div className={styles.filters}>
        <input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select look="filter" aria-label={words.protocolFilter} value={protocol} onChange={(e) => setProtocol(e.target.value)} options={[{ value: '', label: words.anyProtocol }, ...protocols.map((p) => ({ value: p, label: p }))]} />
      </div>
      {profiles.isPending && <QueryLoading label={words.loading} />}
      {profiles.isError && <QueryFailed title={words.failedTitle} body={failureText(profiles.error, locale)} retryLabel={words.retry} onRetry={() => void profiles.refetch()} />}
      {profiles.data && all.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
          <Button variant="primary" onClick={() => void navigate('/profiles/new?from=recipe')}>
            {words.emptyFromRecipe}
          </Button>
          <Button onClick={() => void navigate('/profiles/new')}>{words.create}</Button>
        </div>
      )}
      {profiles.data && all.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {shown.length > 0 && view === 'cards' && (
        <div className={styles.cards}>
          {shown.map((p) => (
            <button key={p.id} type="button" className={styles.card} onClick={() => void navigate(`/profiles/${p.id}`)}>
              <b className={styles.cardName}>{p.name}</b>
              <span className={styles.muted}>
                {p.protocol} · {engineLabel(p.effectiveEngine ?? p.engine ?? p.protocol)}
                {!p.enabled && ` · ${words.disabled}`}
              </span>
              {p.description && <span className={styles.muted}>{p.description}</span>}
              <span>{words.usersCount(fmtNumber(p.userCount ?? 0, locale))}</span>
              <span className={styles.muted}>
                {words.nodesCount(p.bindingCount ?? 0)} · {words.hostsCount(countOf(p.id))}
              </span>
            </button>
          ))}
        </div>
      )}
      {shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.columns.name}</th>
                <th scope="col">{words.columns.protocol}</th>
                <th scope="col">{words.columns.engine}</th>
                <th scope="col">{words.columns.nodes}</th>
                <th scope="col">{words.columns.hosts}</th>
                <th scope="col">{words.columns.users}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={styles.row} onClick={() => void navigate(`/profiles/${p.id}`)}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td>{p.protocol}</td>
                  <td>{engineLabel(p.effectiveEngine ?? p.engine ?? p.protocol)}</td>
                  <td>{p.bindingCount ?? 0}</td>
                  <td>{countOf(p.id) ?? '?'}</td>
                  <td>{fmtNumber(p.userCount ?? 0, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
