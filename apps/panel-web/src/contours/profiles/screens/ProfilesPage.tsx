import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/profiles/components/profiles.module.css'
import { profileFacts } from '@/contours/profiles/lib/profileFacts'
import { profileBindings } from '@/contours/profiles/lib/profileList'
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol'
import { PROTOCOL_TILE_LABEL } from '@/contours/profiles/lib/protocolTiles'
import { RegistryIcon } from '@/ui/Icon/RegistryIcon'
import { DICT } from '@/contours/profiles/dict'
import { useAllBindings, useAllHosts, useProfilesList } from '@/contours/profiles/hooks/useProfiles'
import { engineLabel } from '@/lib/domain/engines'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Icon } from '@/ui/Icon/Icon'
import { EmptyRegistry, QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Popover } from '@/ui/Popover/Popover'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

type View = 'cards' | 'list'
const defaultColumns = ['name','protocol','engine','hosts','nodes','users'] as const
const allColumns = [...defaultColumns,'enabled','created','updated','id'] as const
type Column = typeof allColumns[number]

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
  const [columns, setColumns] = useState<Column[]>([...defaultColumns])
  const [sort, setSort] = useState<{ key: Column; desc: boolean }>({ key: 'name', desc: false })
  const [page, setPage] = useState(0)
  const [limit, setLimit] = useState(0)
  const [tracks, setTracks] = useState(3)
  const [compact,setCompact] = useState(false)
  const [full, setFull] = useState(false)
  const [fullscreenFailed, setFullscreenFailed] = useState(false)
  const table = useRef<HTMLElement>(null)
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement === table.current && table.current !== null)
    document.addEventListener('fullscreenchange',update)
    return () => document.removeEventListener('fullscreenchange',update)
  },[])
  const grid = useRef<HTMLDivElement>(null)


  // Hosts of a profile through its bindings. Unknown until both lists came: not "no hosts".
  const hostCount = useMemo(() => {
    if (bindings.isError || hosts.isError || !bindings.data || !hosts.data) return null
    const profileOf = new Map(bindings.data.bindings.map((b) => [b.id, b.profileId]))
    const counts = new Map<string, number>()
    for (const host of hosts.data.hosts) {
      const id = profileOf.get(host.bindingId)
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [bindings.data, bindings.isError, hosts.data, hosts.isError])

  const all = profiles.data?.profiles ?? []
  const countOf = (id: string) => (hostCount ? (hostCount.get(id) ?? 0) : null)
  const without = hostCount ? all.filter((p) => countOf(p.id) === 0).length : undefined
  const needle = search.trim().toLowerCase()
  const shown = all.filter((p) => (protocol === '' || p.protocol === protocol) && (!noHostsOnly || countOf(p.id) === 0) && (needle === '' || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(needle)))
  const checkingHostFilter = noHostsOnly && hostCount === null
  const failedHostFilter = checkingHostFilter && (bindings.isError || hosts.isError)
  const retryHostFilter = () => {
    if (bindings.isError) void bindings.refetch()
    if (hosts.isError) void hosts.refetch()
  }
  const protocols = [...new Set(all.map((p) => p.protocol))]
  const nodesByProfile = useMemo(() => {
    const grouped = new Map<string,Set<string>>()
    for (const binding of bindings.data?.bindings ?? []) {
      const nodes = grouped.get(binding.profileId) ?? new Set<string>()
      nodes.add(binding.nodeId)
      grouped.set(binding.profileId,nodes)
    }
    return new Map([...grouped].map(([id,nodes])=>[id,nodes.size]))
  },[bindings.data])
  const profileValues = (p: typeof all[number]) => {
    const raw = p.config && 'subprotocol' in p.config ? p.config.subprotocol : undefined
    const plain = p.protocol === 'xray' && isPlainSubprotocol(raw)
    const protocolName = p.protocol === 'xray'
      ? ({ socks: 'SOCKS5', http: 'HTTP', vmess: 'VMess', trojan: 'Trojan' } as Record<string, string>)[String(raw)] ?? 'VLESS'
      : PROTOCOL_TILE_LABEL[p.protocol] ?? p.protocol
    return { name: p.name, protocol: protocolName, engine: engineLabel(p.effectiveEngine ?? p.engine ?? p.protocol), hosts: countOf(p.id),
      nodes: profileBindings(p,nodesByProfile,!!bindings.data && !bindings.isError), users: p.userCount ?? 0, enabled: p.enabled ? words.enabled : words.disabled,
      id: p.id, created: p.createdAt, updated: p.updatedAt, plain }
  }
  const rows = shown.map(profile => ({profile, values: profileValues(profile)}))
  if (view === 'list') rows.sort((a,b) => {
    const first = a.values[sort.key], second = b.values[sort.key]
    if (first == null || second == null) return Number(first == null) - Number(second == null)
    const delta = typeof first === 'number' && typeof second === 'number'
      ? first - second : String(first).localeCompare(String(second),locale)
    return sort.desc ? -delta : delta
  })
  const hasGrid = view === 'cards' && rows.length > 0
  useLayoutEffect(() => {
    const root = grid.current
    if (!root) return
    const resize = () => setTracks(getComputedStyle(root).gridTemplateColumns.split(' ').length)
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    return () => observer.disconnect()
  },[hasGrid])
  const normalLimit = view === 'cards' ? tracks * 3 : 10
  const perPage = limit || normalLimit
  const lastPage = Math.max(0, Math.ceil(rows.length / perPage) - 1)
  const currentPage = Math.min(page,lastPage)
  const start = currentPage * perPage
  const visible = rows.slice(start,start + perPage)
  const names = {...words.columns, id:'ID', created:words.createdColumn, updated:words.updatedColumn, enabled:words.statusColumn}
  const toggleFullscreen = () => {
    setFullscreenFailed(false)
    const action = full ? document.exitFullscreen() : table.current?.requestFullscreen()
    void action?.catch(() => setFullscreenFailed(true))
  }
  const pager = <footer className={styles.registryPager}>
    <span>{start+1}-{start+visible.length} {words.of} {rows.length}</span>
    <select aria-label={words.perPage} value={perPage} onChange={e=>{setLimit(Number(e.target.value));setPage(0)}}>
      {[...new Set([normalLimit,20,50,perPage])].map(n=><option key={n} value={n}>{n} {words.perPage}</option>)}
    </select>
    <Button aria-label={words.prevPage} disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><Icon name="chevronLeft" /></Button>
    <Button aria-label={words.nextPage} disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}><Icon name="chevronRight" /></Button>
  </footer>

  if (profiles.data && all.length === 0) return <EmptyRegistry icon="profiles" title={words.emptyTitle} body={words.emptyBody} action={words.emptyCreate} onCreate={() => void navigate('/profiles/new')} />
  return (
    <div className={styles.page + ' ' + styles.registry}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Chip label={words.all} count={profiles.data ? all.length : undefined} active={!noHostsOnly} onClick={() => {setPage(0);setNoHostsOnly(false)}} />
          <Chip label={words.noHosts} count={without} dot="amber" active={noHostsOnly} onClick={() => {setPage(0);setNoHostsOnly(true)}} />
        </div>
        <div className={styles.chips}>
          <label className={styles.searchBox}><RegistryIcon name="search"/><input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={e=>{setPage(0);setSearch(e.target.value)}} /></label>
          <Popover align="end" trigger={(props) => <Button {...props}><RegistryIcon name="filter"/>{words.filters}{protocol && ` · ${protocol}`}</Button>}>
            <label className={styles.protocolFilter}>{words.protocolFilter}
              <Select look="filter" aria-label={words.protocolFilter} value={protocol} onChange={e=>{setPage(0);setProtocol(e.target.value)}} options={[{ value: '', label: words.anyProtocol }, ...protocols.map(p=>({value:p,label:PROTOCOL_TILE_LABEL[p]??p}))]} />
            </label>
          </Popover>
          <div className={styles.viewIcons}><Segmented<View> label={words.viewLabel} value={view} onChange={next=>{setView(next);setPage(0);setLimit(0)}} options={[{ value: 'cards', label: words.views.cards, icon:<RegistryIcon name="cards"/> }, { value: 'list', label: words.views.list, icon:<Icon name="density"/> }]} /></div>
          <Link className={styles.linkPrimary} to="/profiles/new">
            <Icon name="plus" size="md" />
            {words.create}
          </Link>
        </div>
      </div>
      {profiles.isPending && <QueryLoading label={words.loading} />}
      {profiles.isError && <QueryFailed title={words.failedTitle} body={failureText(profiles.error, locale)} retryLabel={words.retry} onRetry={() => void profiles.refetch()} />}
      {failedHostFilter && <QueryFailedLine retryLabel={words.retry} onRetry={retryHostFilter}>{words.noHostsFailed}</QueryFailedLine>}
      {checkingHostFilter && !failedHostFilter && <QueryLoading label={words.loading} />}
      {profiles.data && !checkingHostFilter && all.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}
      {visible.length > 0 && (view === 'cards' ? <>
        <div ref={grid} className={styles.cards}>
          {visible.map(({profile:p,values:v}) => <button key={p.id} type="button" className={v.hosts===0 ? styles.card+' '+styles.noHostCard : styles.card} onClick={()=>void navigate('/profiles/'+p.id)}>
            <span className={styles.cardHeading}><b className={styles.cardName}>{p.name}</b><small className={styles.protocolBadge}>{v.protocol}{p.protocol==='xray' || v.engine==='sing-box' ? ' · '+v.engine : ''}</small></span>
            <small className={styles.cardDescription}>{p.description}{!p.enabled && (p.description?' · ':'')+words.disabled}</small>
            <span className={styles.cardTotals}><b>{fmtNumber(v.users,locale)}</b> <small>{words.userUnit(v.users)}</small>
              <small>{v.hosts===0 ? words.noHostsBadge : <>{words.hostsCount(v.hosts)} · {words.nodesCount(v.nodes)}</>}</small>
            </span>
            <span className={styles.cardFacts}>{profileFacts(p.protocol,p.config,v.plain).map(({label,value})=><span key={label}>
              <small>{words.factLabels[label] ?? label}</small><span>{label==='security' && value==='reality'?'REALITY':value}</span>
            </span>)}</span>
          </button>)}
        </div>{pager}
      </> : <section ref={table} className={styles.tableBox}>
        <div className={styles.tableTools}><span>{words.columnCount(columns.length,allColumns.length)} · {words.sortedBy} {names[sort.key]}</span>
          <Button aria-label={words.density} aria-pressed={compact} onClick={()=>setCompact(!compact)}><Icon name="density"/></Button>
          <Button aria-label={full ? words.exitFull : words.full} aria-pressed={full} disabled={typeof document === 'undefined' || !document.fullscreenEnabled} onClick={toggleFullscreen}><Icon name="fullscreen"/></Button>
          <Popover align="end" trigger={props=><Button {...props} aria-label={words.chooseColumns}><Icon name="columns" /></Button>}>
            <div className={styles.columnMenu}>{allColumns.map(key=><label key={key}>
              <input type="checkbox" checked={columns.includes(key)} disabled={key==='name'} onChange={e=>setColumns(allColumns.filter(col=>col===key?e.target.checked:columns.includes(col)))}/>
              {names[key]}
            </label>)}</div>
          </Popover>
        </div>
        {fullscreenFailed && <p role="status" className={styles.note}>{words.fullFailed}</p>}
        <div className={styles.tableScroll}><table className={compact ? styles.table+' '+styles.dense : styles.table}>
          <thead><tr>{columns.map(key=><th key={key} scope="col" data-col={key} aria-sort={sort.key===key?(sort.desc?'descending':'ascending'):undefined}>
            <button type="button" onClick={()=>{setSort({key,desc:sort.key===key&&!sort.desc});setPage(0)}}>
              {names[key]}{sort.key===key && <Icon name={sort.desc?'sortDown':'sortUp'} size="sm"/>}
            </button>
          </th>)}</tr></thead>
          <tbody>{visible.map(({profile:p,values:v})=><tr key={p.id} className={styles.row} onClick={()=>void navigate('/profiles/'+p.id)}>
            {columns.map(key=><td key={key} className={key==='hosts'&&v.hosts===0?styles.noHostValue:undefined}>{key==='name'?<Link className={styles.link} to={'/profiles/'+p.id} onClick={e=>e.stopPropagation()}>{p.name}<small>{p.description}</small></Link>:key==='protocol' && p.config && 'security' in p.config && p.config.security==='reality' ? v.protocol+' REALITY' : typeof v[key]==='number'?fmtNumber(v[key],locale):v[key]??'?'}</td>)}
          </tr>)}</tbody>
        </table></div>{pager}
      </section>)}
    </div>
  )
}
