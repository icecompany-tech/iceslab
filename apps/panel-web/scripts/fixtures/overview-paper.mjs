import { readPanel } from './panel-review.mjs'
import { newReviewUsers } from './review-users.mjs'

const G = 1024 ** 3, D = 86400000
const current = [80,76,82,79,88,99,106,91,95,95,91,104,108,121,101,106,101,106,109,119,124,107,111,116,120,123,130,151,118,142]
const previous = [85,82,86,91,86,102,95,86,86,91,86,98,104,101,95,93,102,94,96,113,109,105,105,98,101,105,112,111,104,128]
const dailyComparison = current.map((bytes,i) => ({ date:new Date(Date.UTC(2026,9,5+i)).toISOString().slice(0,10), bytes:bytes*G, previousBytes:previous[i]*G }))
const sum = (values) => values.reduce((n,v)=>n+v,0)*G
const panel = (path) => readPanel(new URL(path,'http://localhost'))
const host = {
  cpu:{loadPercent:12,samplePercent:12,cores:2,loadavg:[.24,.31,.28]},
  memory:{usedBytes:1.1*G,totalBytes:3.8*G,usedPercent:29},
  disk:{usedBytes:20.8*G,totalBytes:39*G,usedPercent:53},
  process:{rssBytes:173*1024**2,heapUsedBytes:100*1024**2,heapLimitBytes:1.3*G,uptimeSeconds:(14*24+3)*3600},
}
const nodeNames = ['de-01','de-02','se-01','nl-02','kz-01','fi-01','no-01','at-01','gb-01','ch-01','fr-01','es-01','pl-01']
export function newOverviewReview(mode = 'normal') {
  const empty = mode === 'empty', now = Date.now()
  const users = newReviewUsers()
  const rows = empty ? [] : Array.from({ length:1358 }, (_,i) => ({
    ...users[i % users.length], id:'overview-user-'+i, username:'review_'+String(i+1).padStart(4,'0'),
    shortId:'review-'+i, subscriptionToken:'demo-'+i, status:i<1204?'active':'disabled',
    expireAt:i<37 || (i>=1204 && i<1212)?new Date(now+2*D).toISOString():null,
    lastOnlineAt:i<318?new Date(now).toISOString():i<402?new Date(new Date(now).setUTCHours(0,0,0,0)).toISOString():null,
  }))
  const seed = panel('/api/nodes').nodes[0]
  const nodes = empty ? [] : nodeNames.map((name,i) => ({
    ...seed,id:'review-'+name,name,address:name+'.example.invalid',countryCode:name.slice(0,2).toUpperCase(),
    status:i===1||i===5?'unreachable':i===4?'unknown':'online',
    lastStatusChange:new Date(now-4*60000).toISOString(),certNotAfter:i===4?null:new Date(now+([82,54,6,140][i]??90)*D).toISOString(),
    engines:i===2?['singbox','amneziawg']:i===0?['xray','singbox','hysteria','naive']:['xray'],
    inboundCount:1,todayBytes:([48,11,36,29,0][i]??3)*G,metrics:null,
  }))
  const hourly=empty?[]:Array.from({length:24},(_,i)=>({hour:new Date(now-(23-i)*3600000).toISOString(),bytes:(i%8+1)*G}))
  const totalBytes = empty ? 0 : sum(current)
  const toUsers = Math.round(totalBytes*.87)
  const traffic={monthlyDirections:{toUsers,fromUsers:totalBytes-toUsers},todayBytes:empty?0:sum([32]),yesterdayBytes:empty?0:sum([89]),last7dBytes:empty?0:sum(current.slice(-7)),
    prev7dBytes:empty?0:sum(current.slice(-14,-7)),last30dBytes:empty?0:sum(current),prev30dBytes:empty?0:sum(previous),calendarMonthBytes:empty?0:sum(current.slice(-3)),
    currentYearBytes:empty?0:sum([...previous,...current]),last24hHourly:hourly,dailyComparison:empty?[]:dailyComparison}
  return {rows,nodes,traffic,failOnce:mode==='traffic-error'}
}

export function overviewReviewReply(state, url) {
  if (url.pathname==='/api/nodes') return [200,{nodes:state.nodes,total:state.nodes.length}]
  const base = panel('/api/dashboard/overview')
  const byStatus = {}
  for (const user of state.rows) byStatus[user.status]=(byStatus[user.status]??0)+1
  const overview={...base,host,nodes:state.nodes,users:{...base.users,byStatus,total:state.rows.length,onlineNow:state.rows.filter(u=>u.lastOnlineAt && Date.parse(u.lastOnlineAt) >= Date.now()-300000).length,onlineToday:state.rows.filter(u=>u.lastOnlineAt).length},
    system:{totalNodeCount:state.nodes.length,onlineNodeCount:state.nodes.filter(n=>n.status==='online').length},
    traffic:state.failOnce?null:state.traffic}
  state.failOnce=false
  return [200,overview]
}
