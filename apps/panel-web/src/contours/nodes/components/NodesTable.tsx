import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { NodeUserCount } from '@/contours/nodes/components/NodeUserCount'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { certTerm } from '@/contours/nodes/lib/nodeCert'
import { useNow } from '@/lib/clock'
import { nodeHealth, type OverviewNode } from '@/lib/domain/overview'
import { fmtBytes, fmtDuration, fmtPercent } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import type { CascadeRole } from '@/lib/old/cascadeMembership'
import type { Node } from '@/lib/old/nodes'
import { CoreChips } from '@/ui/CoreChip/CoreChip'
import { Flag } from '@/ui/Flag/Flag'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'

const columns = ['registryNode','cascade','address','engines','usersColumn','hostsColumn','today','cpu','ram','cert','registryState','region','disk','uptime','maxUsers','multiplier'] as const
type Column = typeof columns[number]
interface Props {
  rows: Node[]
  readings: Map<string, OverviewNode>
  memberships: ReadonlyMap<string,{cascade:{name:string};role:CascadeRole}>
  hostCounts: Map<string, number> | null
  regionNames: Map<string,string>
  open: (node: Node) => void
  footer: ReactNode
}

export function NodesTable({ rows, readings, memberships, hostCounts, regionNames, open, footer }: Props) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const tableBox = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<readonly Column[]>(columns.slice(0, 11))
  const [dense, setDense] = useState(false)
  const active = columns.filter(key => visible.includes(key))
  function cell(key: Column, node: Node) {
    const live = readings.get(node.id)
    const metrics = live?.metrics
    switch (key) {
      case 'registryNode': return <span className={styles.nameCell}><Flag code={node.countryCode} /><Link to={'/nodes/'+node.id} onClick={e=>e.stopPropagation()}>{node.name}</Link></span>
      case 'cascade': {
        const member = memberships.get(node.id)
        return member ? member.cascade.name+', '+words.role[member.role] : '-'
      }
      case 'address': return node.address
      case 'engines': {
        const engines = node.engines ?? node.intendedEngines
        if (!engines) return '?'
        return engines.length ? <CoreChips engines={engines} tone={nodeHealth(node.status)==='problem'?'danger':'accent'} /> : words.agentOnly
      }
      case 'usersColumn': return <NodeUserCount id={node.id} />
      case 'hostsColumn': return hostCounts ? (hostCounts.get(node.id) ?? 0) : '?'
      case 'today': return live && node.status !== 'unknown' ? fmtBytes(live.todayBytes,locale) : '-'
      case 'cpu': return metrics ? fmtPercent(metrics.cpu.usagePercent,locale) : '-'
      case 'ram': return metrics ? fmtPercent(metrics.memory.usedPercent,locale) : '-'
      case 'disk': return metrics ? fmtPercent(metrics.disk.usedPercent,locale) : '-'
      case 'uptime': return metrics ? fmtDuration(metrics.uptimeSeconds,locale) : '-'
      case 'cert': {
        const term = certTerm(node.certNotAfter,now())
        if (!term || term.kind === 'unknown') return words.certUnknown
        if (term.kind === 'expired') return <span className={styles.danger}>{words.certExpired}</span>
        return <span className={term.kind === 'soon' ? styles.amber : undefined}>{words.certDays(term.days)}</span>
      }
      case 'registryState': return node.lastStatusMessage || words.statusWord[node.status] || node.status
      case 'region': return node.regionId ? regionNames.get(node.regionId) ?? '?' : '-'
      case 'maxUsers': return node.maxUsers ?? '-'
      case 'multiplier': return node.consumptionMultiplier ?? '-'
    }
  }
  return <div className={styles.tableBox} ref={tableBox}>
    <div className={styles.tableBar}><span>{words.columnCount(active.length)}</span><div className={styles.chips}>
      <button type="button" aria-label={words.density} title={words.density} aria-pressed={dense} onClick={()=>setDense(!dense)}><Icon name="density"/></button>
      {document.fullscreenEnabled && <button type="button" aria-label={words.fullTable} title={words.fullTable} onClick={()=>{if(document.fullscreenElement) void document.exitFullscreen(); else void tableBox.current?.requestFullscreen()}}><Icon name="fullscreen"/></button>}
      <Popover align="end" trigger={props=><button type="button" {...props} aria-label={words.columns} title={words.columns}><Icon name="columns"/></button>}>
        <div className={styles.columnMenu}>{columns.map(key=><label key={key}><input type="checkbox" checked={active.includes(key)} disabled={key==='registryNode'} onChange={e=>setVisible(e.target.checked?[...visible,key]:visible.filter(c=>c!==key))}/>{words[key]}</label>)}</div>
      </Popover>
    </div></div>
    <div className={styles.tableScroll}><table className={styles.table} data-dense={dense||undefined} data-extended={active.length>11||undefined}>
      <colgroup>{active.map(key=><col key={key} data-col={key}/>)}</colgroup>
      <thead><tr>{active.map(key=><th key={key} scope="col" title={key==='usersColumn'?words.lastNodeUsers:undefined}>{words[key]}</th>)}</tr></thead>
      <tbody>{rows.map(node=><tr key={node.id} className={styles.row} data-health={nodeHealth(node.status)} onClick={()=>open(node)}>
        {active.map(key=><td key={key} data-col={key}>{cell(key,node)}</td>)}
      </tr>)}</tbody>
    </table></div>{footer}
  </div>
}
