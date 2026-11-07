import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FreshnessCell } from '@/contours/hosts/components/FreshnessCell'
import styles from '@/contours/hosts/components/hosts.module.css'
import { DICT } from '@/contours/hosts/dict'
import { useBindingsList, useFleet, useHostsList, useOldSquads, useProfilesList, useReorderHosts } from '@/contours/hosts/hooks/useHosts'
import { hiddenByOperator } from '@/contours/hosts/lib/hostVisibility'
import { nodeHealth } from '@/lib/domain/overview'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { Host } from '@/lib/old/hosts'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { Switch } from '@/ui/Switch/Switch'

// PUT /api/hosts/reorder takes at most this many ids (hosts.routes.ts:162).
const REORDER_LIMIT = 64

type Chips = 'all' | 'alive' | 'down' | 'hidden' | 'off'
type View = 'cards' | 'list'

export default function HostsPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
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
  const shown = all.filter((h) => (chip === 'all' || stateOf(h) === chip) && (country === '' || nodeOf(h)?.countryCode?.toUpperCase() === country) && (needle === '' || `${h.remark} ${h.addressOverride ?? ''} ${nodeOf(h)?.name ?? ''}`.toLowerCase().includes(needle)))
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
          },
        }
      : {}

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Chip label={words.chips.all} count={hosts.data ? all.length : undefined} active={chip === 'all'} onClick={() => setChip('all')} />
          <Chip label={words.chips.alive} count={hosts.data ? count('alive') : undefined} active={chip === 'alive'} onClick={() => setChip('alive')} />
          <Chip label={words.chips.down} count={hosts.data ? count('down') : undefined} dot="danger" active={chip === 'down'} onClick={() => setChip('down')} />
          <Chip label={words.chips.hidden} count={hosts.data ? count('hidden') : undefined} dot="unknown" active={chip === 'hidden'} onClick={() => setChip('hidden')} />
          <Chip label={words.chips.off} count={hosts.data ? count('off') : undefined} active={chip === 'off'} onClick={() => setChip('off')} />
        </div>
        <div className={styles.chips}>
          <Segmented<View> label={words.viewLabel} value={view} onChange={setView} options={[{ value: 'cards', label: words.views.cards }, { value: 'list', label: words.views.list }]} />
          <Link className={styles.linkPrimary} to="/hosts/new">
            <Icon name="plus" size="md" />
            {words.createShort}
          </Link>
        </div>
      </div>
      <div className={styles.filters}>
        <input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select look="filter" aria-label={words.country} value={country} onChange={(e) => setCountry(e.target.value)} options={[{ value: '', label: words.anyCountry }, ...countries.map((c) => ({ value: c, label: c }))]} />
        <Switch label={words.showStale} checked={showStale} onChange={setShowStale} />
      </div>
      {all.length > REORDER_LIMIT && <p className={styles.note}>{words.reorderLimit(REORDER_LIMIT)}</p>}
      {canReorder && all.length > 1 && <p className={styles.note}>{words.dragHint}</p>}
      {reorder.isError && <Banner tone="danger" title={words.reorderFailed}>{failureText(reorder.error, locale)}</Banner>}
      {hosts.isPending && <QueryLoading label={words.loading} />}
      {hosts.isError && <QueryFailed title={words.failedTitle} body={failureText(hosts.error, locale)} retryLabel={words.retry} onRetry={() => void hosts.refetch()} />}
      {hosts.data && all.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{words.emptyTitle}</h2>
          <p>{words.emptyBody}</p>
          <Button variant="primary" onClick={() => void navigate('/hosts/new')}>
            {words.create}
          </Button>
        </div>
      )}
      {hosts.data && all.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {shown.length > 0 && view === 'cards' && (
        <div className={styles.cards}>
          {shown.map((host) => {
            const binding = bindingById.get(host.bindingId)
            const node = nodeOf(host)
            return (
              <button key={host.id} type="button" className={`${styles.card} ${stateOf(host) === 'down' ? styles.cardDown : ''}`} onClick={() => void navigate(`/hosts/${host.id}`)} {...dragProps(host)}>
                <span className={styles.cardHead}>
                  <Flag code={node?.countryCode ?? null} />
                  <b>{host.remark}</b>
                  <span className={styles.protocol}>{binding ? (profileById.get(binding.profileId)?.protocol ?? '') : ''}</span>
                </span>
                <span className={styles.muted}>{host.addressOverride ?? node?.address.split(':')[0] ?? words.unknown}</span>
                <span className={stateOf(host) === 'down' ? styles.danger : styles.muted}>{stateWord(host)}</span>
                <span>
                  {host.reach ? words.usersCount(fmtNumber(host.reach.users, locale)) : words.usersCount(words.unknown)} · {words.squadsCount(squadsOf(host) ?? 0)}
                </span>
                <span className={styles.muted}>
                  {binding ? (profileById.get(binding.profileId)?.name ?? '-') : '-'} · {node?.name ?? '-'} · {binding?.port ?? '-'}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {shown.length > 0 && view === 'list' && (
        <div className={styles.tableBox}>
          <table className={styles.table}>
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
              {shown.map((host) => {
                const binding = bindingById.get(host.bindingId)
                const profile = binding ? profileById.get(binding.profileId) : undefined
                const node = nodeOf(host)
                return (
                  <tr key={host.id} className={styles.row} onClick={() => void navigate(`/hosts/${host.id}`)} {...dragProps(host)}>
                    <td>
                      <span className={styles.cardHead}>
                        <Flag code={node?.countryCode ?? null} />
                        <b>{host.remark}</b>
                      </span>
                    </td>
                    <td className={styles.muted}>{host.addressOverride ?? node?.address.split(':')[0] ?? '-'}</td>
                    <td>{profile?.name ?? '-'}</td>
                    <td className={styles.muted}>{profile?.protocol ?? '-'}</td>
                    <td>{node?.name ?? '-'}</td>
                    <td>{squads.data ? (squadsOf(host) ?? '?') : '?'}</td>
                    <td>{host.reach ? fmtNumber(host.reach.users, locale) : '?'}</td>
                    <td className={stateOf(host) === 'down' ? styles.danger : styles.muted}>{stateWord(host)}</td>
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
          </table>
        </div>
      )}
    </div>
  )
}
