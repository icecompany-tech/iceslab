import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CascadeCard } from '@/contours/cascades/components/CascadeCard'
import styles from '@/contours/cascades/components/cascades.module.css'
import { DICT } from '@/contours/cascades/dict'
import { useBindingsAll, useCascadeStatuses, useCascadesList, useFleet, useOldSquads, useOutbounds, useRoutePolicies } from '@/contours/cascades/hooks/useCascades'
import { MAX_POSITIONS } from '@/contours/cascades/lib/cascadeForm'
import { cascadeRow, type CascadeRow } from '@/contours/cascades/lib/rows'
import { useOverview } from '@/lib/domain/overview'
import { fmtBytes, fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { CascadeStatus } from '@/lib/old/cascades'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Field } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

type View = 'cards' | 'list'
type ChipValue = 'all' | 'on' | 'off' | 'broken'
interface Filters {
  entry: string
  exit: string
  protocol: string
  squad: string
}
const NO_FILTERS: Filters = { entry: '', exit: '', protocol: '', squad: '' }
const NO_POLICIES: never[] = []

const unique = (list: readonly string[]) => [...new Set(list.filter(Boolean))].sort()

export default function CascadesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const cascades = useCascadesList()
  const fleet = useFleet()
  const overview = useOverview()
  const bindings = useBindingsAll()
  const squads = useOldSquads()
  const policies = useRoutePolicies()
  const outbounds = useOutbounds()
  const list = useMemo(() => cascades.data?.cascades ?? [], [cascades.data])
  const onIds = useMemo(() => list.filter((c) => c.enabled).map((c) => c.id), [list])
  const statuses = useCascadeStatuses(onIds)
  const [view, setView] = useState<View>('cards')
  const [chip, setChip] = useState<ChipValue>('all')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  const nodeById = new Map((fleet.data?.nodes ?? []).map((n) => [n.id, n]))
  const todayById = new Map((overview.data?.nodes ?? []).map((n) => [n.id, n.todayBytes]))
  const statusById = new Map<string, CascadeStatus | undefined>(onIds.map((id, i) => [id, statuses[i]?.data]))
  const sideFailed = bindings.isError || squads.isError || policies.isError
  const rows: CascadeRow[] = list.map((c) =>
    cascadeRow(
      c,
      {
        nodeById,
        outboundById: outbounds.data ? new Map(outbounds.data.outbounds.map((o) => [o.id, o])) : null,
        statusOf: (id) => statusById.get(id),
        todayOf: (id) => todayById.get(id),
        bindings: bindings.data?.bindings,
        squads: squads.data?.squads,
        policies: policies.data?.policies ?? (policies.isError ? NO_POLICIES : undefined),
      },
      words,
    ),
  )
  const countryOf = (id: string) => nodeById.get(id)?.countryCode ?? ''
  const needle = search.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (needle && !`${r.cascade.name} ${r.nodeNames.map((n) => n.name).join(' ')}`.toLowerCase().includes(needle)) return false
    if (filters.entry && !r.shape.entryNodeIds.some((id) => countryOf(id) === filters.entry)) return false
    if (filters.exit && !r.shape.countries.includes(filters.exit)) return false
    if (filters.protocol && r.shape.entryProtocol !== filters.protocol) return false
    if (filters.squad && !r.reach?.squads.some((s) => s.name === filters.squad)) return false
    return true
  })
  const count = (value: ChipValue) => {
    switch (value) {
      case 'all':
        return filtered.length
      case 'on':
        return filtered.filter((r) => r.cascade.enabled).length
      case 'off':
        return filtered.filter((r) => !r.cascade.enabled).length
      case 'broken':
        return filtered.filter((r) => r.push.kind === 'broken').length
    }
  }
  const shown = filtered.filter((r) => {
    switch (chip) {
      case 'all':
        return true
      case 'on':
        return r.cascade.enabled
      case 'off':
        return !r.cascade.enabled
      case 'broken':
        return r.push.kind === 'broken'
    }
  })
  const active = Object.values(filters).filter(Boolean).length
  const pick = (name: string, value: string, options: readonly string[], onChange: (next: string) => void) => (
    <Field label={name}>{(a11y) => <Select {...a11y} look="filter" value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: words.filterAny }, ...options.map((o) => ({ value: o, label: o }))]} />}</Field>
  )

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Segmented<'nodes' | 'cascades'> label={words.segmentLabel} value="cascades" onChange={(v) => v === 'nodes' && void navigate('/nodes')} options={[{ value: 'nodes', label: words.segmentNodes }, { value: 'cascades', label: words.segmentCascades }]} />
          <Chip label={words.chipAll} count={cascades.data ? count('all') : undefined} active={chip === 'all'} onClick={() => setChip('all')} />
          <Chip label={words.chipOn} count={cascades.data ? count('on') : undefined} active={chip === 'on'} onClick={() => setChip('on')} />
          <Chip label={words.chipOff} count={cascades.data ? count('off') : undefined} dot="unknown" active={chip === 'off'} onClick={() => setChip('off')} />
          <Chip label={words.chipBroken} count={cascades.data ? count('broken') : undefined} dot="danger" active={chip === 'broken'} onClick={() => setChip('broken')} />
        </div>
        <div className={styles.chips}>
          <Segmented<View> label={words.viewLabel} value={view} onChange={setView} options={[{ value: 'cards', label: words.viewCards }, { value: 'list', label: words.viewList }]} />
          <Link className={styles.linkPrimary} to="/cascades/new">
            <Icon name="plus" size="md" />
            {words.create}
          </Link>
        </div>
      </div>
      <div className={styles.chips}>
        <input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Popover
          align="end"
          trigger={(props) => (
            <Button {...props} size="sm" icon={<Icon name="filter" size="md" />}>
              {active > 0 ? `${words.filters}: ${active}` : words.filters}
            </Button>
          )}
        >
          <div className={styles.filters}>
            {pick(words.filterCountIn, filters.entry, unique(rows.flatMap((r) => r.shape.entryNodeIds.map(countryOf))), (entry) => setFilters({ ...filters, entry }))}
            {pick(words.filterCountOut, filters.exit, unique(rows.flatMap((r) => r.shape.countries)), (exit) => setFilters({ ...filters, exit }))}
            {pick(words.filterProtocol, filters.protocol, unique(rows.flatMap((r) => r.shape.entryProtocol ?? '')), (protocol) => setFilters({ ...filters, protocol }))}
            {pick(words.filterSquad, filters.squad, unique((squads.data?.squads ?? []).map((s) => s.name)), (squad) => setFilters({ ...filters, squad }))}
            <Button size="sm" onClick={() => setFilters(NO_FILTERS)}>
              {words.filterReset}
            </Button>
          </div>
        </Popover>
      </div>
      {sideFailed && (
        <QueryFailedLine
          retryLabel={words.retry}
          onRetry={() => {
            void bindings.refetch()
            void squads.refetch()
            void policies.refetch()
          }}
        >
          {words.sideFailed}
        </QueryFailedLine>
      )}
      {(cascades.isPending || fleet.isPending) && <QueryLoading label={words.loading} />}
      {cascades.isError && <QueryFailed title={words.failedTitle} body={failureText(cascades.error, locale)} retryLabel={words.retry} onRetry={() => void cascades.refetch()} />}
      {fleet.isError && <QueryFailed title={words.nodesFailedTitle} body={failureText(fleet.error, locale)} retryLabel={words.retry} onRetry={() => void fleet.refetch()} />}
      {cascades.data && fleet.data && list.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
          <Button variant="primary" onClick={() => void navigate('/cascades/new')}>
            {words.create}
          </Button>
        </div>
      )}
      {cascades.data && fleet.data && list.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {fleet.data && shown.length > 0 && view === 'cards' && (
        <div className={styles.cards}>
          {shown.map((row) => (
            <CascadeCard key={row.cascade.id} row={row} />
          ))}
        </div>
      )}
      {fleet.data && shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{words.colCascade}</th>
                <th scope="col">{words.colState}</th>
                <th scope="col">{words.colHops}</th>
                <th scope="col">{words.colPath}</th>
                <th scope="col">{words.colReach}</th>
                <th scope="col">{words.colToday}</th>
                <th scope="col">{words.colPush}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.cascade.id}>
                  <td>
                    <Link className={styles.link} to={`/cascades/${r.cascade.id}`}>
                      {r.cascade.name}
                    </Link>
                  </td>
                  <td>{r.cascade.enabled ? words.stateOn : words.stateOff}</td>
                  <td>{`${r.hops}/${MAX_POSITIONS}`}</td>
                  <td>{r.path}</td>
                  <td>{r.reach === null ? '?' : r.reach.squads.length === 0 ? words.reachNobody : words.reachSquads(r.reach.squads.map((s) => s.name).join(', '), fmtNumber(r.reach.users, locale))}</td>
                  <td>{r.today === null ? '-' : fmtBytes(r.today, locale)}</td>
                  <td className={r.push.kind === 'broken' ? styles.danger : undefined}>{r.push.kind === 'broken' ? r.push.broken : r.push.kind === 'done' ? words.pushDone : r.push.kind === 'pending' ? words.pushPending(r.push.waiting.join(', ')) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
