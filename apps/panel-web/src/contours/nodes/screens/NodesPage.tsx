import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NodeCard } from '@/contours/nodes/components/NodeCard'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCascades, useFleet, useRegions } from '@/contours/nodes/hooks/useNodes'
import { NodesTable } from '@/contours/nodes/components/NodesTable'
import { Popover } from '@/ui/Popover/Popover'
import { RegistryIcon } from '@/ui/Icon/RegistryIcon'
import { useBindingsList, useHostsList } from '@/lib/domain/hostInventory'
import { nodeHealth, useOverview, type NodeHealth } from '@/lib/domain/overview'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { cascadeMemberships } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'

type ChipFilter = 'all' | NodeHealth
type View = 'cards' | 'list' | 'cascades'
type CascadeFilter = 'all' | 'one' | 'in'

export default function NodesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
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

  const [pageIndex,setPageIndex] = useState(0)
  const [perPage,setPerPage] = useState<number | null>(null)
  const [columns,setColumns] = useState(3)
  const grid = useRef<HTMLDivElement>(null)
  const hosts = useHostsList()
  const bindings = useBindingsList()
  const hostCounts = useMemo(() => {
    if (!hosts.data || !bindings.data) return null
    const nodeOf = new Map(bindings.data.bindings.map(b=>[b.id,b.nodeId]))
    const counts = new Map<string,number>()
    for (const host of hosts.data.hosts) {
      const id = nodeOf.get(host.bindingId)
      if (!id) return null
      counts.set(id,(counts.get(id) ?? 0)+1)
    }
    return counts
  }, [hosts.data,bindings.data])
  const regionNames = new Map((regions.data?.regions ?? []).map(r=>[r.id,r.name]))

  const membershipKnown = cascades.isSuccess
  const memberships = useMemo(() => cascadeMemberships(membershipKnown ? cascades.data.cascades : []), [membershipKnown, cascades.data])
  const grouped = view === 'cascades' && membershipKnown
  const showCards = view === 'cards' || (view === 'cascades' && !membershipKnown)
  const live = useMemo(() => new Map((overview.data?.nodes ?? []).map((n) => [n.id, n])), [overview.data])
  const nodes = fleet.data?.nodes ?? []
  const count = (health: NodeHealth) => nodes.filter((n) => nodeHealth(n.status) === health).length
  const needle = search.trim().toLowerCase()
  const shown = nodes.filter(
    (n) =>
      (chip === 'all' || nodeHealth(n.status) === chip) &&
      (region === '' || n.regionId === region) &&
      (!membershipKnown || cascadeFilter === 'all' || (cascadeFilter === 'in') === memberships.has(n.id)) &&
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

  const hasGrid = showCards && shown.length>0
  useLayoutEffect(() => {
    if (!hasGrid || !grid.current || typeof ResizeObserver==='undefined') return
    const el = grid.current
    const measure = () => setColumns(getComputedStyle(el).gridTemplateColumns.split(' ').length || 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasGrid])
  const pageSize = perPage ?? (showCards ? columns*3 : 10)
  const lastPage = Math.max(0,Math.ceil(shown.length/pageSize)-1)
  const currentPage = Math.min(pageIndex,lastPage)
  const offset = currentPage*pageSize
  const healthOrder: Record<NodeHealth, number> = {problem:0,unverified:1,ok:2,off:3}
  const ordered = view === 'list' ? [...shown].sort((a,b)=>healthOrder[nodeHealth(a.status)]-healthOrder[nodeHealth(b.status)]) : shown
  const visible = ordered.slice(offset,offset+pageSize)
  const footer = <footer className={styles.pager}>
    <span>{words.pageRange(offset+1,offset+visible.length,shown.length)}</span>
    <select aria-label={words.perPage} value={pageSize} onChange={e=>{setPerPage(Number(e.target.value));setPageIndex(0)}}>
      {[...new Set([showCards?columns*3:10,20,50])].map(size=><option key={size} value={size}>{size} · {words.perPage}</option>)}
    </select>
    <button type="button" aria-label={words.prevPage} disabled={currentPage===0} onClick={()=>setPageIndex(currentPage-1)}><Icon name="chevronLeft"/></button>
    <button type="button" aria-label={words.nextPage} disabled={currentPage===lastPage} onClick={()=>setPageIndex(currentPage+1)}><Icon name="chevronRight"/></button>
  </footer>
  return (
    <div className={styles.registry}>
      {(!fleet.data || nodes.length > 0) && <div className={styles.toolbar}>
        <div className={styles.chips}>
          <Segmented<'nodes' | 'cascades'> label={words.sectionLabel} value="nodes" onChange={(v) => v === 'cascades' && void navigate('/cascades')} options={[{ value: 'nodes', label: words.sectionNodes }, { value: 'cascades', label: words.sectionCascades }]} />
          <Chip label={words.chips.all} count={fleet.data ? nodes.length : undefined} active={chip === 'all'} onClick={() => {setChip('all');setPageIndex(0)}} />
          <Chip label={words.chips.ok} count={fleet.data ? count('ok') : undefined} active={chip === 'ok'} onClick={() => {setChip('ok');setPageIndex(0)}} />
          <Chip label={words.chips.problem} count={fleet.data ? count('problem') : undefined} dot="danger" active={chip === 'problem'} onClick={() => {setChip('problem');setPageIndex(0)}} />
          <Chip label={words.chips.unverified} count={fleet.data ? count('unverified') : undefined} dot="unknown" active={chip === 'unverified'} onClick={() => {setChip('unverified');setPageIndex(0)}} />
        </div>
        <div className={styles.toolbarRight}>
          <label className={styles.searchBox}><RegistryIcon name="search"/><input className={styles.search} aria-label={words.search} placeholder={words.search} value={search} onChange={e=>{setSearch(e.target.value);setPageIndex(0)}}/></label>
          <Popover align="end" trigger={props=><Button {...props} icon={<RegistryIcon name="filter"/>}>{words.filters}</Button>}>
            <div className={styles.filterMenu}>
              <label>{words.cascadeFilter}<Select look="filter" aria-label={words.cascadeFilter} disabled={!membershipKnown} value={cascadeFilter} onChange={e=>{setCascadeFilter(e.target.value as CascadeFilter);setPageIndex(0)}} options={[{value:'all',label:words.cascadeAny},{value:'one',label:words.cascadeOne},{value:'in',label:words.cascadeIn}]}/></label>
              <label>{words.region}<Select look="filter" aria-label={words.region} value={region} onChange={e=>{setRegion(e.target.value);setPageIndex(0)}} options={[{value:'',label:words.anyRegion},...(regions.data?.regions ?? []).map(r=>({value:r.id,label:r.name}))]}/></label>
            </div>
          </Popover>
          <div role="radiogroup" aria-label={words.viewLabel} className={styles.views}>
            {(['cards','list','cascades'] as const).map(v=><button key={v} type="button" role="radio" aria-label={words.views[v]} title={words.views[v]} aria-checked={view===v} onClick={()=>{setView(v);setPageIndex(0);setPerPage(null)}}>
              {v==='cards' ? <RegistryIcon name="cards"/> : <Icon name={v==='list'?'density':'routes'}/>}
            </button>)}
          </div>
          <Link className={styles.linkPrimary} to="/nodes/new"><Icon name="plus"/>{words.create}</Link>
        </div>
      </div>}
      {fleet.data && nodes.length > 0 && cascades.isError && <QueryFailedLine retryLabel={words.retry} onRetry={() => void cascades.refetch()}>{words.cascadesUnknown}</QueryFailedLine>}
      {fleet.isPending && <QueryLoading label={words.loading} />}
      {fleet.isError && <QueryFailed title={words.failedTitle} body={failureText(fleet.error, locale)} retryLabel={words.retry} onRetry={() => void fleet.refetch()} />}
      {fleet.data && nodes.length === 0 && (
        <div className={styles.blank}>
          <span className={styles.blankIcon}><Icon name="nodes"/></span>
          <h2>{words.emptyTitle}</h2><p>{words.emptyBody}</p>
          <Link className={styles.linkPrimary} to="/nodes/new"><Icon name="plus"/>{words.firstNode}</Link>
        </div>
      )}
      {fleet.data && nodes.length > 0 && shown.length === 0 && <div className={styles.empty}>{words.emptyFiltered}</div>}

      {shown.length > 0 && showCards && (
        <div className={styles.cards} ref={grid}>
          {visible.map((node) => (
            <NodeCard key={node.id} node={node} hostCount={hostCounts ? hostCounts.get(node.id) ?? 0 : undefined} live={live.get(node.id)} membership={memberships.get(node.id)} onOpen={() => open(node)} />
          ))}
        </div>
      )}

      {hasGrid && footer}
      {shown.length > 0 && view === 'list' && <NodesTable rows={visible} readings={live} memberships={memberships} hostCounts={hostCounts} regionNames={regionNames} open={open} footer={footer}/>}
      {shown.length > 0 && grouped && (
        <div className={styles.groups}>
          {groups.byCascade.map(([name, members]) => (
            <section key={name} className={styles.group}>
              <h2 className={styles.groupTitle}>{name}</h2>
              <div className={styles.cards}>
                {members.map((node) => (
                  <NodeCard key={node.id} node={node} hostCount={hostCounts ? hostCounts.get(node.id) ?? 0 : undefined} live={live.get(node.id)} membership={memberships.get(node.id)} onOpen={() => open(node)} />
                ))}
              </div>
            </section>
          ))}
          {groups.outside.length > 0 && (
            <section className={styles.group}>
              <h2 className={styles.groupTitle}>{words.outsideCascades}</h2>
              <div className={styles.cards}>
                {groups.outside.map((node) => (
                  <NodeCard key={node.id} node={node} hostCount={hostCounts ? hostCounts.get(node.id) ?? 0 : undefined} live={live.get(node.id)} onOpen={() => open(node)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
