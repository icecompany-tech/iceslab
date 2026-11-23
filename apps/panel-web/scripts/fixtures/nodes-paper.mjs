import { readPanel } from './panel-review.mjs'

// Names and sample readings from the Nodes artboards. All endpoints are served locally.
const sample = [
  ["nl-ams-01","185.22.153.4",["xray","sing-box"],12,34,41,3,48,21],
  ["de-fra-01","91.142.77.10",["xray","sing-box","hy2"],31,52,28,5,36,63],
  ["se-sto-01","46.17.40.12",["xray"],0,0,0,1,29,0],
  ["nl-ams-03","185.22.153.9",["xray"],8,22,17,1,18,12],
  ["de-fra-02","91.142.77.18",["xray"],18,46,33,2,11,5],
  ["nl-ams-02","185.22.153.7",["xray","sing-box"],9,27,36,2,24,8],
  ["de-fra-03","91.142.77.44",[],1,9,6,0,0,2],
  ["ru-msk-01","5.188.74.21",["xray","sing-box"],64,88,47,4,72,31],
  ["kz-ala-01","89.218.13.5",["awg"],0,0,0,0,0,0],
  ["nl-ams-04","185.22.153.12",["xray","sing-box"],12,34,41,3,48,21],
  ["nl-ams-06","185.22.153.21",["xray","sing-box"],12,34,41,3,48,21],
  ["nl-ams-05","185.22.153.15",["xray"],8,22,17,1,18,12],
  ["se-sto-02","46.17.40.31",["xray"],14,31,0,2,12,0]
]
const problems = new Map([
  ['se-sto-01', ['unreachable', 'dial tcp, i/o timeout']],
  ['de-fra-02', ['degraded', 'Нода не резолвит домены']],
  ['nl-ams-02', ['degraded', 'Ядро отвергло конфиг']],
])
const days = { 'de-fra-01': 6, 'de-fra-02': 54, 'se-sto-01': 82, 'nl-ams-02': 120, 'de-fra-03': 89, 'ru-msk-01': 33, 'se-sto-02': 77 }
const base = path => readPanel(new URL(path, 'http://localhost'))
const gib = 1024 ** 3
const day = 86400000

export function newNodesReview(empty = false) {
  const now = Date.now()
  const nodes = [], bindings = [], hosts = []
  for (const [name, address, tags, cpu, ram, disk, hostCount, today, uptime] of empty ? [] : sample) {
    const [status, message] = problems.get(name) ?? [name === 'kz-ala-01' ? 'unknown' : 'online', null]
    const engines = tags.map(t => ({ 'sing-box':'singbox', hy2:'hysteria', awg:'amneziawg' })[t] ?? t)
    nodes.push({ ...base('/api/nodes').nodes[0], id:name, name, address, countryCode:name.slice(0,2).toUpperCase(), engines, status, lastStatusMessage:message,
      lastStatusChange:new Date(now-240000).toISOString(), regionId:name.startsWith('kz-') ? 'as' : 'eu',
      agentCanRotate:name !== 'ru-msk-01', certNotAfter:status === 'unknown' ? null : new Date(now+((days[name] ?? 140)+0.5)*day).toISOString(),
      consumptionMultiplier:name === 'de-fra-03' ? 0.5 : 1, inboundCount:engines.length, todayBytes:today*gib,
      metrics:status==='unknown'||status==='unreachable' ? null : {cpu:{usagePercent:cpu,cores:2},memory:{usedPercent:ram,totalBytes:4*gib,usedBytes:4*gib*ram/100},disk:{usedPercent:disk,totalBytes:50*gib,usedBytes:50*gib*disk/100},uptimeSeconds:uptime*86400} })
    const bindingId = 'nodes-demo-' + name
    bindings.push({...base('/api/bindings').bindings[0],id:bindingId,nodeId:name})
    for(let i=0;i<hostCount;i++) hosts.push({...base('/api/hosts').hosts[0],id:bindingId+'-'+i,bindingId})
  }
  const example = base('/api/cascades').cascades[0]
  const cascades = empty ? [] : [['a4-test','ru-msk-01',['nl-ams-03','se-sto-01','se-sto-02']],['ru-de','nl-ams-05',['de-fra-02']],['kz-relay','kz-ala-01',['nl-ams-06']]].map(([id,entry,exits])=>({...example,id,name:id,enabled:true,hops:[],positions:[{...example.positions[0],position:0,nodeIds:[entry]}],directions:[{...example.directions[0],id:id+'-exit',nodeIds:exits}]}))
  return {nodes,bindings,hosts,cascades,install:'https',pendingReports:new Map()}
}

export function nodesReviewReply(scene, path) {
  if (path === '/api/nodes') {
    for (const node of scene.nodes) {
      const due = scene.pendingReports.get(node.id)
      if (!due || due > Date.now()) continue
      node.status = 'online'
      node.lastStatusChange = new Date(due).toISOString()
      node.engines = node.intendedEngines
      node.cores = { observedAt: node.lastStatusChange, cores: node.engines.map(engine => ({ name: engine, engine, installed: true, version: ({xray:'26.3.27',hysteria:'2.12.3'})[engine] })) }
      scene.pendingReports.delete(node.id)
    }
    return {nodes:scene.nodes,total:scene.nodes.length}
  }
  if(path==='/api/regions') return {regions:[{id:'eu',name:'Europe',code:'EU'},{id:'as',name:'Asia',code:'AS'}]}
  if(path==='/api/hosts') return {hosts:scene.hosts}
  if(path==='/api/bindings') return {bindings:scene.bindings}
  if(path==='/api/cascades') return {cascades:scene.cascades}
  if(path==='/api/dashboard/overview') return {...base(path),nodes:scene.nodes,system:{totalNodeCount:scene.nodes.length,onlineNodeCount:scene.nodes.filter(n=>n.status==='online').length}}
}

export function createReviewNode(scene, input) {
  const { name, address, intendedEngines = [] } = input
  if (typeof name !== 'string' || !name.trim() || typeof address !== 'string' || !address.trim() || !Array.isArray(intendedEngines)) {
    return [400, { message: 'Name and address are required' }]
  }
  if (scene.nodes.some(node => node.name === name || node.address === address)) {
    return [409, { message: scene.nodes.some(node => node.name === name) ? 'Node name exists' : 'Node address exists' }]
  }
  const id = 'review-' + (scene.nodes.length + 1)
  const node = { ...base('/api/nodes').nodes[0], id, name, address, protocol: input.protocol,
    intendedEngines, countryCode: input.countryCode ?? null, regionId: input.regionId ?? null,
    status: 'unknown', cores: null, metrics: null, engines: undefined, inboundCount: 0, todayBytes: 0,
    certNotAfter: null, lastStatusChange: null, lastStatusMessage: null }
  scene.nodes.push(node)
  if (scene.install === 'agent') scene.pendingReports.set(id, Date.now() + 20000)
  const payloadOnly = scene.install === 'file'
  const flag = payloadOnly ? '--payload-file /root/iceslab-node.payload' : '--panel-url https://panel.example.invalid --bootstrap DEMO'
  const parts = ['review-install --source https://releases.example.invalid/iceslab/v0.4.0/install-iceslab-node.sh', flag, intendedEngines.length ? '--engines ' + intendedEngines.join(',') : '', '--panel-ip 203.0.113.10']
  const command = parts.filter(Boolean).join(' ' + String.fromCharCode(92) + '\n  ')
  return [201, { ...node, payload: 'ICESLAB PAPER REVIEW - SAMPLE FILE', bootstrap: { token: 'DEMO', command, payloadOnly, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() } }]
}
