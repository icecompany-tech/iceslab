import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HostToolbarIcon } from '@/contours/hosts/components/HostToolbarIcon'
import { FreshnessCell } from '@/contours/hosts/components/FreshnessCell'
import styles from '@/contours/hosts/components/hosts.module.css'
import { DICT } from '@/contours/hosts/dict'
import { useBindingsList, useFleet, useHostsList, useOldSquads, useProfilesList, useReorderHosts } from '@/contours/hosts/hooks/useHosts'
import { hiddenByOperator } from '@/contours/hosts/lib/hostVisibility'
import { nodeHealth } from '@/lib/domain/overview'
import { fmtNumber } from '@/lib/format'
import { useNow } from '@/lib/clock'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { Host } from '@/lib/old/hosts'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { EmptyRegistry, QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Popover } from '@/ui/Popover/Popover'
import { hostEndpoint, hostProtocol, statusAge } from '@/contours/hosts/lib/hostDisplay'
import { profileTransport } from '@/lib/old/profileTransport'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'

// PUT /api/hosts/reorder takes at most this many ids (hosts.routes.ts:162).
const REORDER_LIMIT = 64

type Chips = 'all' | 'alive' | 'down' | 'hidden' | 'off'
type View = 'cards' | 'list'

export default function HostsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const navigate = useNavigate()
  const hosts = useHostsList()
  const bindings = useBindingsList()
  const nodes = useFleet()
  const profiles = useProfilesList()
  const squads = useOldSquads()
  const reorder = useReorderHosts()
  const [chip, setChip] = useState<Chips>('all')
  const [view, setView] = useState<View>('list')
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [showStale, setShowStale] = useState(false)
  const [dragged, setDragged] = useState<string | null>(null)

  const [pageIndex, setPageIndex] = useState(0)
  const [columns, setColumns] = useState(3)
  const grid = useRef<HTMLDivElement>(null)
  const [pageOverride, setPageOverride] = useState<number | null>(null)
  const pageSize = pageOverride ?? (view === 'cards' ? columns * 3 : 10)

  const bindingById = useMemo(() => new Map((bindings.data?.bindings ?? []).map((b) => [b.id, b])), [bindings.data])
  const nodeById = useMemo(() => new Map((nodes.data?.nodes ?? []).map((n) => [n.id, n])), [nodes.data])
  const profileById = useMemo(() => new Map((profiles.data?.profiles ?? []).map((p) => [p.id, p])), [profiles.data])
  const all = hosts.data?.hosts ?? []
  const nodeOf = (h: Host) => {
    const b = bindingById.get(h.bindingId)
    return b ? nodeById.get(b.nodeId) : undefined
  }
  const stateOf = (h: Host): Exclude<Chips, 'all'> => {
    if (!h.enabled) return 'off'
    if (h.hiddenByCascade || hiddenByOperator(h)) return 'hidden'
    const node = nodeOf(h)
    return node && nodeHealth(node.status) === 'problem' ? 'down' : 'alive'
  }
  const stateWord = (h: Host) => (h.hiddenByCascade ? words.stateHidden : hiddenByOperator(h) ? words.stateOperatorHidden : { alive: words.stateAlive, down: words.stateDown, hidden: words.stateHidden, off: words.stateOff }[stateOf(h)])
  const squadsOf = (h: Host) => h.reach?.squads
  const count = (state: Exclude<Chips, 'all'>) => all.filter((h) => stateOf(h) === state).length
  const countries = [...new Set((nodes.data?.nodes ?? []).flatMap((n) => (n.countryCode ? [n.countryCode.toUpperCase()] : [])))].sort()
  const needle = search.trim().toLowerCase()
  const shown = all.filter((h) => {
    const binding = bindingById.get(h.bindingId)
    const node = nodeOf(h)
    const profile = binding && profileById.get(binding.profileId)
    const searchable = [h.remark, hostEndpoint(h, node, binding), binding?.port, node?.name, profile?.name].join(' ').toLowerCase()
    return (chip === 'all' || stateOf(h) === chip) && (!country || node?.countryCode?.toUpperCase() === country) && searchable.includes(needle)
  })
  const hasCards = view === 'cards' && shown.length > 0
  useLayoutEffect(() => {
    const el = grid.current
    if (!hasCards || !el) return
    const update = () => setColumns(getComputedStyle(el).gridTemplateColumns.split(' ').length)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasCards])
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
  const page = Math.min(pageIndex, lastPage)
  const start = page * pageSize
  const visible = shown.slice(start, start + pageSize)
  const canReorder = all.length <= REORDER_LIMIT && chip === 'all' && needle === '' && country === ''

  const move = (id: string, to: 'top' | 'bottom' | string) => {
    const others = all.map((h) => h.id).filter((x) => x !== id)
    if (to === 'top') others.unshift(id)
    else if (to === 'bottom') others.push(id)
    else others.splice(others.indexOf(to), 0, id)
    reorder.mutate(others)
  }
  const dragProps = (host: Host) =>
    canReorder
      ? {
          draggable: true,
          onDragStart: () => setDragged(host.id),
          onDragEnd: () => setDragged(null),
          onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
          onDrop: () => {
            if (dragged && dragged !== host.id) move(dragged, host.id)
            setDragged(null)
          },
        }
      : {}

  function dropAt(to: 'top' | 'bottom') {
    if (dragged) move(dragged, to)
    setDragged(null)
  }
  const pager = <footer className={styles.pager}>
    <span>{words.range(start + 1, start + visible.length, shown.length)}</span>
    {dragged && <span className={styles.dropTargets}>
      {(['top', 'bottom'] as const).map((to) => <button key={to} type="button" onDragOver={e => e.preventDefault()} onDrop={() => dropAt(to)} onClick={() => dropAt(to)}>{to === 'top' ? words.moveTop : words.moveBottom}</button>)}
    </span>}
    <select aria-label={words.pageSize} value={pageSize} onChange={e => {setPageOverride(Number(e.target.value)); setPageIndex(0)}}>
      {[...new Set([view === 'cards' ? columns * 3 : 10, 20, 50, pageSize])].map(n => <option key={n} value={n}>{words.perPage(n)}</option>)}
    </select>
    <button type="button" aria-label={words.previous} disabled={page === 0} onClick={() => setPageIndex(page - 1)}><Icon name="chevronLeft" /></button>
    <button type="button" aria-label={words.next} disabled={page >= lastPage} onClick={() => setPageIndex(page + 1)}><Icon name="chevronRight" /></button>
  </footer>
  if (hosts.data && all.length === 0) return <EmptyRegistry icon="hosts" title={words.emptyTitle} body={words.emptyBody} action={words.create} onCreate={() => void navigate('/hosts/new')} />
  return (
    <div className={`${styles.page} ${styles.registry}`}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Chip label={words.chips.all} count={hosts.data ? all.length : undefined} active={chip === 'all'} onClick={() => { setChip('all'); setPageIndex(0) }} />
          <Chip label={words.chips.alive} count={hosts.data ? count('alive') : undefined} active={chip === 'alive'} onClick={() => { setChip('alive'); setPageIndex(0) }} />
          <Chip label={words.chips.down} count={hosts.data ? count('down') : undefined} dot="danger" active={chip === 'down'} onClick={() => { setChip('down'); setPageIndex(0) }} />
          <Chip label={words.chips.hidden} count={hosts.data ? count('hidden') : undefined} dot="amber" active={chip === 'hidden'} onClick={() => { setChip('hidden'); setPageIndex(0) }} />
          <Chip label={words.chips.off} count={hosts.data ? count('off') : undefined} active={chip === 'off'} onClick={() => { setChip('off'); setPageIndex(0) }} />
        </div>
        <div className={styles.chips}>
          <label className={styles.searchBox}><HostToolbarIcon name="search" /><input className={styles.search} aria-label={words.search} placeholder={words.placeholder} value={search} onChange={e => { setSearch(e.target.value); setPageIndex(0) }} /></label>
          <Popover align="end" trigger={props => <Button {...props} icon={<HostToolbarIcon name="filter" />}>{words.filters}</Button>}>
            <div className={styles.filterMenu}>
              <Select look="filter" aria-label={words.country} value={country} onChange={e => {setCountry(e.target.value); setPageIndex(0)}} options={[{value: '', label: words.anyCountry}, ...countries.map(c => ({value: c, label: c}))]} />
              <Switch label={words.showStale} checked={showStale} onChange={setShowStale} />
            </div>
          </Popover>
          <div role="radiogroup" aria-label={words.viewLabel} className={styles.views}>
            {(['cards', 'list'] as const).map(v => <button key={v} type="button" role="radio" aria-label={words.views[v]} title={words.views[v]} aria-checked={view === v} onClick={() => {setView(v); setPageOverride(null); setPageIndex(0)}}>
              {v === 'cards' ? <HostToolbarIcon name="cards" /> : <Icon name="density" />}
            </button>)}
          </div>
          <Link className={styles.linkPrimary} to="/hosts/new">
            <Icon name="plus" />
            {words.createShort}
          </Link>
        </div>
      </div>
      {all.length > REORDER_LIMIT && <p className={styles.note}>{words.reorderLimit(REORDER_LIMIT)}</p>}
      {reorder.isError && <Banner tone="danger" title={words.reorderFailed}>{failureText(reorder.error, locale)}</Banner>}
      {hosts.isPending && <QueryLoading label={words.loading} />}
      {hosts.isError && <QueryFailed title={words.failedTitle} body={failureText(hosts.error, locale)} retryLabel={words.retry} onRetry={() => void hosts.refetch()} />}
      {hosts.data && all.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {shown.length > 0 && view === 'cards' && (
        <div className={styles.cards} ref={grid}>
          {visible.map((host) => {
            const binding = bindingById.get(host.bindingId)
            const node = nodeOf(host)
            const profile = binding && profileById.get(binding.profileId)
            const state = stateOf(host)
            const count = host.reach?.users
            return (
              <button data-state={state} data-dragging={dragged === host.id || undefined} key={host.id} type="button" className={`${styles.card} ${stateOf(host) === 'down' ? styles.cardDown : ''}`} onClick={() => void navigate(`/hosts/${host.id}`)} {...dragProps(host)}>
                <span className={styles.cardHead}>
                  <Flag code={node?.countryCode ?? null} />
                  <b>{host.remark}</b>
                  {(state === 'off' || hiddenByOperator(host)) && <small>{stateWord(host)}</small>}
                  <span className={styles.protocol}>{hostProtocol(profile, true)}</span>
                </span>
                <span className={styles.endpoint}>{hostEndpoint(host, node, binding) || words.unknown}</span>
                <span className={styles.reach}>
                  <span><b>{count === undefined ? '?' : fmtNumber(count, locale)}</b> {words.usersNoun(count ?? 0)}</span>
                  <span>{state === 'down' ? stateWord(host) + statusAge(node, locale, now()) : host.hiddenByCascade ? stateWord(host) + ' ' + host.hiddenByCascade.cascadeName : words.squadTotal(squadsOf(host))}</span>
                </span>
                <span className={styles.metadata}>
                  <span><small>{words.col.profile}</small>{profile?.name ?? '-'}</span>
                  <span><small>{words.col.node}</small>{node?.name ?? '-'}</span>
                  <span><small>{words.port}</small>{binding ? binding.port + '/' + (binding.transport ?? profileTransport(profile)) : '-'}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <div className={styles.tableCaption}>{words.tableHint(showStale ? 9 : 8)}</div>
          <div className={styles.tableScroll}><table className={styles.table} data-stale={showStale || undefined}>
            <thead>
              <tr>
                <th scope="col">{words.col.host}</th>
                <th scope="col">{words.col.address}</th>
                <th scope="col">{words.col.profile}</th>
                <th scope="col">{words.col.protocol}</th>
                <th scope="col">{words.col.node}</th>
                <th scope="col">{words.col.squads}</th>
                <th scope="col">{words.col.users}</th>
                <th scope="col">{words.col.state}</th>
                {showStale && <th scope="col">{words.col.stale}</th>}
                <th scope="col" aria-label={words.moveTop} />
              </tr>
            </thead>
            <tbody>
              {visible.map((host) => {
                const binding = bindingById.get(host.bindingId)
                const profile = binding ? profileById.get(binding.profileId) : undefined
                const node = nodeOf(host)
                return (
                  <tr key={host.id} className={styles.row} onClick={() => void navigate(`/hosts/${host.id}`)} {...dragProps(host)}>
                    <td>
                      <span className={styles.cardHead}>
                        <Flag code={node?.countryCode ?? null} />
                        <Link to={`/hosts/${host.id}`} className={styles.rowName} onClick={e => e.stopPropagation()}>{host.remark}</Link>
                      </span>
                    </td>
                    <td className={styles.muted}>{hostEndpoint(host, node, binding) || '-'}</td>
                    <td>{profile?.name ?? '-'}</td>
                    <td className={styles.muted}>{hostProtocol(profile)}</td>
                    <td>{node?.name ?? '-'}</td>
                    <td>{squads.data ? (squadsOf(host) ?? '?') : '?'}</td>
                    <td>{host.reach ? fmtNumber(host.reach.users, locale) : '?'}</td>
                    <td className={stateOf(host) === 'down' ? styles.danger : styles.muted}>{stateWord(host)}{stateOf(host) === 'down' ? statusAge(node, locale, now()) : ''}</td>
                    {showStale && (
                      <td>
                        <FreshnessCell id={host.id} name={host.remark} />
                      </td>
                    )}
                    <td onClick={(e) => e.stopPropagation()}>
                      {canReorder && (
                        <span className={styles.chips}>
                          <button type="button" className={styles.iconButton} aria-label={words.moveTop} onClick={() => move(host.id, 'top')}>
                            <Icon name="arrowUp" size="sm" />
                          </button>
                          <button type="button" className={styles.iconButton} aria-label={words.moveBottom} onClick={() => move(host.id, 'bottom')}>
                            <Icon name="arrowDown" size="sm" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
          {pager}
        </div>
      )}
      {hasCards && pager}
    </div>
  )
}
