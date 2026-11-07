import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NodeCard } from '@/contours/nodes/components/NodeCard'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCascades, useFleet, useRegions } from '@/contours/nodes/hooks/useNodes'
import { certTerm } from '@/contours/nodes/lib/nodeCert'
import { useNow } from '@/lib/clock'
import { nodeHealth, useOverview, type NodeHealth } from '@/lib/domain/overview'
import { fmtBytes } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeMemberships } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { CoreChips } from '@/ui/CoreChip/CoreChip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

type ChipFilter = 'all' | NodeHealth
type View = 'cards' | 'list' | 'cascades'
type CascadeFilter = 'all' | 'one' | 'in'

export default function NodesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const navigate = useNavigate()
  const fleet = useFleet()
  const overview = useOverview()
  const regions = useRegions()
  const cascades = useCascades()
  const [chip, setChip] = useState<ChipFilter>('all')
  const [view, setView] = useState<View>('cards')
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('')
  const [cascadeFilter, setCascadeFilter] = useState<CascadeFilter>('all')

  const memberships = useMemo(() => cascadeMemberships(cascades.data?.cascades ?? []), [cascades.data])
  const live = useMemo(() => new Map((overview.data?.nodes ?? []).map((n) => [n.id, n])), [overview.data])
  const nodes = fleet.data?.nodes ?? []
  const count = (health: NodeHealth) => nodes.filter((n) => nodeHealth(n.status) === health).length
  const needle = search.trim().toLowerCase()
  const shown = nodes.filter(
    (n) =>
      (chip === 'all' || nodeHealth(n.status) === chip) &&
      (region === '' || n.regionId === region) &&
      (cascadeFilter === 'all' || (cascadeFilter === 'in') === memberships.has(n.id)) &&
      (needle === '' || `${n.name} ${n.address}`.toLowerCase().includes(needle)),
  )
  const open = (node: Node) => void navigate(`/nodes/${node.id}`)

  const groups = useMemo(() => {
    const byCascade = new Map<string, Node[]>()
    const outside: Node[] = []
    for (const node of shown) {
      const member = memberships.get(node.id)
      if (!member) {
        outside.push(node)
        continue
      }
      byCascade.set(member.cascade.name, [...(byCascade.get(member.cascade.name) ?? []), node])
    }
    return { byCascade: [...byCascade.entries()], outside }
  }, [shown, memberships])

  const certOf = (node: Node) => {
    const term = certTerm(node.certNotAfter, now())
    if (!term || term.kind === 'unknown') return <span className={styles.muted}>{words.certUnknown}</span>
    if (term.kind === 'expired') return <span className={styles.danger}>{words.certExpired}</span>
    return <span className={term.kind === 'soon' ? styles.amber : styles.muted}>{words.certDays(term.days)}</span>
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Segmented<'nodes' | 'cascades'> label={words.sectionLabel} value="nodes" onChange={(v) => v === 'cascades' && void navigate('/cascades')} options={[{ value: 'nodes', label: words.sectionNodes }, { value: 'cascades', label: words.sectionCascades }]} />
          <Chip label={words.chips.all} count={fleet.data ? nodes.length : undefined} active={chip === 'all'} onClick={() => setChip('all')} />
          <Chip label={words.chips.ok} count={fleet.data ? count('ok') : undefined} active={chip === 'ok'} onClick={() => setChip('ok')} />
          <Chip label={words.chips.problem} count={fleet.data ? count('problem') : undefined} dot="danger" active={chip === 'problem'} onClick={() => setChip('problem')} />
          <Chip label={words.chips.unverified} count={fleet.data ? count('unverified') : undefined} dot="unknown" active={chip === 'unverified'} onClick={() => setChip('unverified')} />
        </div>
        <div className={styles.toolbarRight}>
          <Segmented<View> label={words.viewLabel} value={view} onChange={setView} options={[{ value: 'cards', label: words.views.cards }, { value: 'list', label: words.views.list }, { value: 'cascades', label: words.views.cascades }]} />
          <Link className={styles.linkPrimary} to="/nodes/new">
            <Icon name="plus" size="md" />
            {words.add}
          </Link>
        </div>
      </div>
      <div className={styles.filters}>
        <input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select look="filter" aria-label={words.region} value={region} onChange={(e) => setRegion(e.target.value)} options={[{ value: '', label: words.anyRegion }, ...(regions.data?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))]} />
        <Select
          look="filter"
          aria-label={words.cascadeFilter}
          value={cascadeFilter}
          onChange={(e) => setCascadeFilter(e.target.value as CascadeFilter)}
          options={[{ value: 'all', label: words.cascadeAny }, { value: 'one', label: words.cascadeOne }, { value: 'in', label: words.cascadeIn }]}
        />
      </div>

      {fleet.isPending && <QueryLoading label={words.loading} />}
      {fleet.isError && <QueryFailed title={words.failedTitle} body={failureText(fleet.error, locale)} retryLabel={words.retry} onRetry={() => void fleet.refetch()} />}
      {fleet.data && nodes.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
          <Button variant="primary" onClick={() => void navigate('/nodes/new')}>
            {words.add}
          </Button>
        </div>
      )}
      {fleet.data && nodes.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}

      {shown.length > 0 && view === 'cards' && (
        <div className={styles.cards}>
          {shown.map((node) => (
            <NodeCard key={node.id} node={node} live={live.get(node.id)} membership={memberships.get(node.id)} onOpen={() => open(node)} />
          ))}
        </div>
      )}

      {shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.name}</th>
                <th scope="col">{words.address}</th>
                <th scope="col">{words.engines}</th>
                <th scope="col" title={words.usersUnknownHint}>
                  {words.usersColumn}
                </th>
                <th scope="col">{words.today}</th>
                <th scope="col">{words.cert}</th>
                <th scope="col">{words.cascade}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((node) => {
                const member = memberships.get(node.id)
                const today = live.get(node.id)?.todayBytes
                return (
                  <tr key={node.id} className={styles.row} onClick={() => open(node)}>
                    <td>
                      <span className={styles.nameCell}>
                        <span className={`${styles.dot} ${styles[`dot_${nodeHealth(node.status)}`]}`} />
                        <Flag code={node.countryCode} />
                        <b>{node.name}</b>
                      </span>
                    </td>
                    <td className={styles.muted}>{node.address}</td>
                    <td>{node.engines || node.intendedEngines ? <CoreChips engines={node.engines ?? node.intendedEngines ?? []} tone={nodeHealth(node.status) === 'problem' ? 'danger' : 'accent'} /> : <span className={styles.muted}>{words.metricsUnknown}</span>}</td>
                    <td className={styles.muted} title={words.usersUnknownHint}>
                      ?
                    </td>
                    <td>{today === undefined ? <span className={styles.muted}>{words.metricsUnknown}</span> : fmtBytes(today, locale)}</td>
                    <td>{certOf(node)}</td>
                    <td className={styles.muted}>{member ? `${member.cascade.name}, ${words.role[member.role] ?? member.role}` : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && view === 'cascades' && (
        <div className={styles.groups}>
          {groups.byCascade.map(([name, members]) => (
            <section key={name} className={styles.group}>
              <h2 className={styles.groupTitle}>{name}</h2>
              <div className={styles.cards}>
                {members.map((node) => (
                  <NodeCard key={node.id} node={node} live={live.get(node.id)} membership={memberships.get(node.id)} onOpen={() => open(node)} />
                ))}
              </div>
            </section>
          ))}
          {groups.outside.length > 0 && (
            <section className={styles.group}>
              <h2 className={styles.groupTitle}>{words.outsideCascades}</h2>
              <div className={styles.cards}>
                {groups.outside.map((node) => (
                  <NodeCard key={node.id} node={node} live={live.get(node.id)} onOpen={() => open(node)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
