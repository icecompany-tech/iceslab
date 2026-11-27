import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from '@/contours/squads/components/squads.module.css'
import { DICT } from '@/contours/squads/dict'
import { useBindingsAll, useCascadesAll, useFleet, useHostsAll, useOldSquads, usePresetsAll, useProfilesAll, useRoutePoliciesAll } from '@/contours/squads/hooks/useSquadsData'
import { useSquadOrder } from '@/contours/squads/hooks/useSquadOrder'
import { aclIdsOf, isCascadeEntry } from '@/contours/squads/lib/squadCascades'
import { ALL_SQUAD_ID } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { readStored, writeStored } from '@/lib/storage'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { RegistryIcon } from '@/ui/Icon/RegistryIcon'
import { Popover } from '@/ui/Popover/Popover'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { Select } from '@/ui/Select/Select'

const initialCols = ['name', 'users', 'countries', 'profiles', 'hosts', 'cascades'] as const
const allCols = [...initialCols, 'policies', 'preset', 'devices', 'id', 'created', 'updated'] as const
type Column = typeof allCols[number]
type View = 'cards' | 'list'
const emptyFilters = {country:'',profile:'',cascade:'',policy:'',preset:'',hosts:''}

export default function SquadsPage() {
  const words = useDict(DICT)
  const {locale} = useLocale()
  const navigate = useNavigate()
  const squads = useOldSquads(), hosts = useHostsAll(), bindings = useBindingsAll(), fleet = useFleet()
  const profiles = useProfilesAll(), cascades = useCascadesAll(), policies = useRoutePoliciesAll(), presets = usePresetsAll()
  const [view, setView] = useState<View>(() => readStored('iceslab:squads-view', v => v === 'list' ? 'list' : 'cards') ?? 'cards')
  const [columns, setColumns] = useState<Column[]>(() => readStored('iceslab:squads-columns', v => Array.isArray(v) ? allCols.filter(k => k === 'name' || v.includes(k)) : [...initialCols]) ?? [...initialCols])
  const [filters, setFilters] = useState(emptyFilters)
  const [search, setSearch] = useState('')
  const [pageIndex, setPage] = useState(0)
  const [override, setOverride] = useState(0)
  const [tracks, setTracks] = useState(3)
  const [compact, setCompact] = useState(false)
  const [full, setFull] = useState(false)
  const [sort, setSort] = useState<{key:Column; dir:number} | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const all = squads.data?.squads ?? []
  const names = {...words.col,policies:words.blockPolicies,preset:words.preset,devices:words.deviceLimit,id:'ID',created:words.added,updated:words.updated}
  const byBinding = new Map(bindings.data?.bindings.map(b => [b.id,b]))
  const byNode = new Map(fleet.data?.nodes.map(n => [n.id,n]))
  const byProfile = new Map(profiles.data?.profiles.map(p => [p.id, p]))
  const activeCascades = cascades.data?.cascades.filter(c => c.enabled)
  const rows = all.map(squad => {
    const system = squad.id === ALL_SQUAD_ID
    const available = hosts.data && bindings.data ? hosts.data.hosts.filter(h => h.enabled && !h.hiddenByCascade && !h.isHidden && (system || squad.profileIds.includes(byBinding.get(h.bindingId)?.profileId ?? ''))) : undefined
    const handed = available?.filter(h => system || !squad.hostIds.length || squad.hostIds.includes(h.id))
    const nodeIds = new Set(handed?.map(h => byBinding.get(h.bindingId)?.nodeId))
    const countries = handed && fleet.data && [...nodeIds].every(id => id && byNode.get(id)?.countryCode)
      ? [...new Set(Array.from(nodeIds).flatMap(id => byNode.get(id!)?.countryCode?.toUpperCase() || []))].sort()
      : undefined
    const permitted = activeCascades?.filter(c => {
      const rule = squad.exitAcl.find(e => e.cascadeId === c.id)
      return system || !rule || aclIdsOf(rule).length > 0
    })
    const served = handed && profiles.data ? permitted?.filter(c => handed.some(h => {
      const binding = byBinding.get(h.bindingId)
      return binding && isCascadeEntry(c, binding.nodeId, byProfile.get(binding.profileId)?.protocol ?? '')
    })) : undefined
    const missingEntry = served !== undefined && permitted !== undefined && served.length < permitted.length
    const preset = squad.customRoutingPresetId ?? squad.routingPreset ?? ''
    const numbers = {users:squad.memberCount, countries:countries?.length, profiles:system ? profiles.data?.profiles.length : squad.profileIds.length, hosts:handed?.length, cascades:served?.length, policies:squad.policyIds.length, devices:squad.hwidDeviceLimit}
    return {squad,system,available,handed,countries,served,missingEntry,preset,numbers}
  })
  type Row = typeof rows[number]
  const presetTitle = (id:string) => presets.data?.presets.find(p => p.id === id)?.name ?? words.presetNames[id] ?? (id ? words.presetUnnamed : words.presetInherit)
  const filtered = Object.values(filters).some(Boolean) || search.trim() !== ''
  const shown = rows.filter(r => {
    const s = r.squad
    return (!search.trim() || (s.name+' '+(s.description ?? '')).toLowerCase().includes(search.trim().toLowerCase())) &&
      (!filters.country || r.countries?.includes(filters.country)) &&
      (!filters.profile || r.system || s.profileIds.includes(filters.profile)) &&
      (!filters.cascade || r.served?.some(c => c.id === filters.cascade)) &&
      (!filters.policy || s.policyIds.includes(filters.policy)) &&
      (!filters.preset || r.preset === filters.preset) &&
      (!filters.hosts || (filters.hosts === 'none' ? r.handed?.length === 0 : !!r.handed?.length && (filters.hosts==='narrow' ? !r.system && !!s.hostIds.length : r.system || !s.hostIds.length)))
  })
  const valueOf = (r:Row, key:Column):string | number => {
    switch (key) {
      case 'name': case 'id': return r.squad[key]
      case 'created': return r.squad.createdAt
      case 'updated': return r.squad.updatedAt
      case 'preset': return presetTitle(r.preset)
      case 'users': case 'countries': case 'profiles': case 'hosts':
      case 'cascades': case 'policies': case 'devices':
        return r.numbers[key] ?? -1
    }
  }
  if (sort) shown.sort((a,b) => {
    const av=valueOf(a,sort.key), bv=valueOf(b,sort.key)
    return sort.dir * (typeof av==='number' && typeof bv==='number' ? av-bv : String(av).localeCompare(String(bv),locale))
  })
  const order = useSquadOrder(all, !filtered && !sort)
  const hasGrid = view === 'cards' && shown.length > 0
  useLayoutEffect(() => {
    const el = grid.current
    if (!hasGrid || !el) return
    const update = () => setTracks(Math.max(1,getComputedStyle(el).gridTemplateColumns.split(' ').length))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  },[hasGrid])
  const per = override || (view === 'cards' ? tracks*3 : 10)
  const lastPage = Math.max(0,Math.ceil(shown.length/per)-1), page = Math.min(pageIndex,lastPage)
  const start = page*per, visible = shown.slice(start,start+per)
  // Keep the native drag source mounted when the pointer advances a page.
  const carried = order.drag && !visible.some(r => r.squad.id===order.drag?.id) ? rows.find(r => r.squad.id===order.drag?.id) : undefined
  const displayed = carried ? [...visible,carried] : visible
  const status = filtered ? words.filtered : sort ? words.sorted : words.orderHint
  function filter(key:keyof typeof filters,value:string) { setFilters({...filters,[key]:value}); setPage(0) }
  function option(key:keyof typeof filters, label:string, options:{value:string;label:string}[]) {
    return <label>{label}<Select look="filter" aria-label={label} value={filters[key]} onChange={e=>filter(key,e.target.value)} options={[{value:'',label:words.any},...options]} /></label>
  }
  const optionOf = (r:{id:string;name:string}) => ({value:r.id,label:r.name})
  const flags = (r:Row) => <span className={styles.flags}>{!r.countries || !r.handed ? words.hostsUnknown : r.handed.length === 0 ? <span className={styles.amber}>{words.noHost}</span> : <>{r.countries.slice(0,3).map(c => <Flag key={c} code={c} />)}{r.countries.length>3 && <small>+{r.countries.length-3}</small>}</>}</span>
  const cell = (r:Row,key:Column) => {
    const s=r.squad
    switch(key) {
      case 'name': return <><span className={styles.cardHeading}><b>{s.name}</b>{r.system && <small className={styles.system}>{words.system}</small>}</span><small>{s.description}</small></>
      case 'users': return fmtNumber(s.memberCount,locale)
      case 'countries': return r.handed?.length === 0 ? '–' : flags(r)
      case 'hosts': return !r.available || !r.handed ? words.hostsUnknown : !r.handed.length ? '0' : s.hostIds.length && !r.system ? words.hostsOf(r.handed.length,r.available.length) : words.hostsAll(r.available.length)
      case 'profiles': return !profiles.data ? words.hostsUnknown : r.system ? words.hostsAll(profiles.data.profiles.length) : words.hostsOf(s.profileIds.length,profiles.data.profiles.length)
      case 'cascades': return !activeCascades || !r.handed || !r.served ? words.hostsUnknown : words.hostsOf(r.served.length,activeCascades.length)
      case 'preset': return presetTitle(r.preset)
      case 'policies': return s.policyIds.length
      case 'devices': return s.hwidDeviceLimit ?? '–'
      case 'created': case 'updated': {const date=s[key==='created'?'createdAt':'updatedAt'];return date ? new Date(date).toLocaleDateString(locale) : '–'}
      case 'id': return s.id
    }
  }
  const factTone = (r:Row, key:Column) => {
    const empty = key === 'profiles' && !!profiles.data && r.numbers.profiles === 0 || key === 'hosts' && r.handed?.length === 0
    return empty || key === 'cascades' && r.missingEntry ? styles.amber : undefined
  }
  const dragClass = (id:string) => [carried?.squad.id===id && styles.carried,order.drag?.id===id && styles.dragged,order.over===id && order.drag?.id!==id && styles.insertion].filter(Boolean).join(' ')
  const dragPage = (e:DragEvent, next:number) => {
    if (!order.drag || e.currentTarget.contains(e.relatedTarget as Node | null)) return
    e.preventDefault()
    setPage(next)
  }
  const footer = <footer className={styles.pager}>
    <span>{start+1}-{start+visible.length} {words.of} {shown.length}{view==='cards' && ' · '+status}</span>
    {order.drag && <span className={styles.dropTargets}>{[words.first,words.last].map((label,i)=><button type="button" key={label} onDragOver={e=>e.preventDefault()} onDrop={()=>void order.drop(i===0?all[0]?.id??null:null)}>{label}</button>)}</span>}
    <select aria-label={words.perPage} value={per} onChange={e=>{setOverride(Number(e.target.value));setPage(0)}}>{[...new Set([view==='cards'?tracks*3:10,20,50])].map(n=><option key={n} value={n}>{n} {words.perPage}</option>)}</select>
    <button type="button" aria-label={words.prev} disabled={!page} onDragEnter={e=>dragPage(e,Math.max(0,page-1))} onClick={()=>setPage(page-1)}><Icon name="chevronLeft"/></button>
    <button type="button" aria-label={words.next} disabled={page===lastPage} onDragEnter={e=>dragPage(e,Math.min(lastPage,page+1))} onClick={()=>setPage(page+1)}><Icon name="chevronRight"/></button>
  </footer>
  return <div className={styles.registry}>
    <div className={styles.toolbar}><div className={styles.chips}>
      <Chip label={words.all} count={squads.data?all.length:undefined} active={!filtered} onClick={()=>{setFilters(emptyFilters);setSearch('');setPage(0)}} />
      <Chip label={words.noHosts} count={hosts.data && bindings.data?rows.filter(r=>r.handed?.length===0).length:undefined} dot="amber" active={filters.hosts==='none'} onClick={()=>filter('hosts',filters.hosts==='none'?'':'none')}/>
    </div><div className={styles.tools}>
      <label className={styles.searchBox}><RegistryIcon name="search"/><input className={styles.search} aria-label={words.search} placeholder={words.searchPlaceholder} value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label>
      <Popover align="end" trigger={props=><button className={styles.toolButton} type="button" {...props}><RegistryIcon name="filter"/>{words.filters}</button>}>
        <div className={styles.filters}>
          {option('country',words.country,[...new Set(rows.flatMap(r=>r.countries ?? []))].sort().map(v=>({value:v,label:v})))}
          {option('profile',words.profile,(profiles.data?.profiles??[]).map(optionOf))}
          <div>{option('cascade',words.cascade,(activeCascades??[]).map(optionOf))}{option('policy',words.policy,(policies.data?.policies??[]).map(optionOf))}</div>
          <div>{option('preset',words.preset,[...new Set(rows.map(r=>r.preset).filter(Boolean))].map(v=>({value:v,label:presetTitle(v)})))}{option('hosts',words.col.hosts,[{value:'none',label:words.noHosts},{value:'narrow',label:words.limitedHosts},{value:'wide',label:words.allHosts}])}</div>
          {Object.values(filters).some(Boolean) && <Button onClick={()=>{setFilters(emptyFilters);setPage(0)}}>{words.resetFilters}</Button>}
        </div>
      </Popover>
      <div className={styles.toggle} role="radiogroup" aria-label={words.viewLabel}>{(['cards','list'] as const).map(v=><button type="button" key={v} role="radio" aria-checked={view===v} aria-label={words.views[v]} onClick={()=>{setView(v);writeStored('iceslab:squads-view',v);setPage(0);setOverride(0)}}>{v==='cards'?<RegistryIcon name="cards"/>:<Icon name="density"/>}</button>)}</div>
      <Link className={styles.linkPrimary} to="/squads/new"><Icon name="plus" size="md"/>{words.create}</Link>
    </div></div>
    {order.message && <p role="status" className={styles.note}>{order.message}</p>}
    {squads.isPending && <QueryLoading label={words.loading}/>}
    {squads.isError && <QueryFailed title={words.failedTitle} body={failureText(squads.error,locale)} retryLabel={words.retry} onRetry={()=>void squads.refetch()}/>}
    {squads.data && !shown.length && <div className={styles.empty}>{!all.length?<><h2>{words.emptyTitle}</h2><p>{words.emptyBody}</p><Link to="/squads/new">{words.createSquad}</Link></>:words.emptyFiltered}</div>}
    {!!shown.length && (view==='cards'?<>
      <div ref={grid} className={styles.cards}>{displayed.map(r=>
        <button key={r.squad.id} type="button" data-squad={r.squad.id} className={[styles.card,dragClass(r.squad.id),r.handed?.length===0?styles.noHosts:''].join(' ')} {...order.props(r.squad.id)} onClick={()=>void navigate('/squads/'+r.squad.id)}>
          <span className={styles.cardHeading}><b>{r.squad.name}</b>{r.system && <small className={styles.system}>{words.system}</small>}</span>
          <small className={styles.description}>{r.squad.description}</small>
          <span className={styles.totals}><b>{cell(r,'users')}</b><small>{words.userUnit(r.squad.memberCount)}</small>{flags(r)}</span>
          <span className={styles.cardFacts}>{(['profiles','hosts','cascades'] as const).map(key=><span key={key}><small>{names[key]}</small><strong className={factTone(r,key)}>{cell(r,key)}</strong></span>)}</span>
        </button>)}</div>{footer}</>:
      <section className={[styles.tableBox,full?styles.full:''].join(' ')}>
        <div className={styles.tableTools}><span>{columns.length} {words.of} {allCols.length} {words.columns} · {status}</span>
          <button type="button" aria-label={words.density} aria-pressed={compact} onClick={()=>setCompact(!compact)}><Icon name="density"/></button>
          <button type="button" aria-label={words.full} aria-pressed={full} onClick={()=>setFull(!full)}><Icon name="fullscreen"/></button>
          <Popover align="end" trigger={props=><button type="button" aria-label={words.tableOptions} {...props}><Icon name="columns"/></button>}>
            <div className={styles.options}>{allCols.map(key=><label key={key}><input type="checkbox" disabled={key==='name'} checked={columns.includes(key)} onChange={e=>{const next=allCols.filter(k=>k===key?e.target.checked:columns.includes(k));setColumns(next);writeStored('iceslab:squads-columns',next)}}/>{names[key]}</label>)}</div>
          </Popover>
        </div>
        <div className={styles.scroll}><table className={styles.table}><thead><tr>{columns.map(key=><th key={key} scope="col" data-squad-col={key} aria-sort={sort?.key===key?(sort.dir===1?'ascending':'descending'):undefined}><button type="button" onClick={()=>{setSort(sort?.key!==key?{key,dir:1}:sort.dir===1?{key,dir:-1}:null);setPage(0)}}>{names[key]}{sort?.key===key && <Icon name={sort.dir===1?'sortUp':'sortDown'}/>}</button></th>)}</tr></thead>
        <tbody>{displayed.map(r=><tr key={r.squad.id} data-squad={r.squad.id} className={[styles.row,dragClass(r.squad.id),r.handed?.length===0 && styles.noHosts,compact?styles.compact:''].join(' ')} {...order.props(r.squad.id)} onClick={()=>void navigate('/squads/'+r.squad.id)}>{columns.map(key=><td key={key} className={factTone(r,key)}>{key==='name'?<Link draggable={false} className={styles.cardLink} onClick={e=>e.stopPropagation()} to={'/squads/'+r.squad.id}>{cell(r,key)}</Link>:cell(r,key)}</td>)}</tr>)}</tbody>
        </table></div>{footer}
      </section>)}
  </div>
}
