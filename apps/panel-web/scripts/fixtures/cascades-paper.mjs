import { randomUUID } from 'node:crypto'
import { newNodesReview } from './nodes-paper.mjs'
import { readPanel } from './panel-review.mjs'

const base = path => readPanel(new URL(path, 'http://localhost'))
const fields = ['entryPolicy', 'directions[].linkProtocol', 'directions[].outboundId']
const pos = (node, position = 0, protocol = 'xray') => ({ position, nodeIds: [node], entryProtocol: position === 0 ? protocol : null, linkProtocol: 'xray', linkParams: null })
const dir = (id, tag, countryCode, nodeIds) => ({ id, tag, countryCode, nodeIds, outboundId: null, linkProtocol: null, linkParams: null, linkPort: 24000 + tag })
const make = (name, positions, directions, enabled = true) => ({
  ...base('/api/cascades').cascades[0], id: name, name, positions, directions, enabled, hops: [],
  autoProfile: directions.length > 1, nextDirectionTag: directions.length + 1,
})

export function newCascadeReview() {
  const scene = newNodesReview()
  const clone = (id, source, address, bytes) => ({ ...scene.nodes.find(n => n.id === source), id, name: id, countryCode: id.slice(0,2).toUpperCase(), address, todayBytes: bytes * 1024 ** 3 })
  scene.nodes.push(clone('ru-spb-01','ru-msk-01','5.188.91.40',11), clone('kz-ala-02','de-fra-01','89.218.13.9',0), clone('fi-hel-01','nl-ams-01','65.21.40.17',0))
  for (const n of scene.nodes) {
    n.coreVersion = n.engines.includes('xray') ? '26.3.27' : null
    n.cores = n.status === 'unknown' ? null : {observedAt: new Date().toISOString(), cores:n.engines.map(engine => ({name:engine,engine,version:engine==='xray'?'26.3.27':engine==='singbox'?'1.13.14':undefined,installed:true}))}
  }
  scene.cascades = [
    make('a4-test',[pos('ru-msk-01')],[dir('a-nl',1,'NL',['nl-ams-03']),dir('a-se',2,'SE',['se-sto-01','se-sto-02'])]),
    make('ru-de',[pos('ru-spb-01',0,'hysteria'),{...pos('kz-ala-02',1),linkParams:{underlay:'awg'}}],[dir('r-de',1,'DE',['de-fra-02'])]),
    make('kz-relay',[pos('kz-ala-01')],[dir('k-fi',1,'FI',['fi-hel-01'])],false),
  ]
  scene.bindings = ['ru-msk-01','ru-spb-01'].map((nodeId,i)=>({...base('/api/bindings').bindings[0],id:'cascade-bind-'+i,nodeId,profileId:i?'hy2':'vless'}))
  scene.squads = ['premium','basic'].map((name,i)=>({...base('/api/squads').squads[0],id:name,name,profileIds:[i?'hy2':'vless'],memberCount:i?186:548,policyIds:i?[]:['ads','ru']}))
  return scene
}

export function readCascadeReview(scene,path) {
  if (path === '/api/cascades') return {cascades:scene.cascades,fields}
  if (path === '/api/squads') return {squads:scene.squads}
  if (path === '/api/route-policies') return {policies:[{id:'ads',name:'Без рекламы',ordinal:1},{id:'ru',name:'RU direct',ordinal:2}]}
  if (path === '/api/named-outbounds') return {outbounds:[{...base(path).outbounds[0],id:'vless-us-1',name:'vless-us-1',type:'vless',countryCode:'US',config:{server:'198.51.100.4',port:443},usedBy:[]}]}
  const id = /^\/api\/cascades\/([^/]+)\/status$/.exec(path)?.[1]
  const c = scene.cascades.find(item=>item.id===id)
  if (c) {
    const ids = [...c.positions,...c.directions].flatMap(p=>p.nodeIds)
    const hops = ids.map(nodeId=>({nodeId,name:scene.nodes.find(n=>n.id===nodeId)?.name??nodeId,applied:nodeId!=='se-sto-01',online:nodeId!=='se-sto-01'}))
    return {done:hops.every(h=>h.applied),broken:null,hops}
  }
}

export function writeCascadeReview(scene,method,path,body) {
  const id = path.split('/')[3]
  const existing = scene.cascades.find(c=>c.id===id)
  if (id && !existing) return [404,{message:'Cascade not found'}]
  if (method==='DELETE' && existing) { scene.cascades=scene.cascades.filter(c=>c!==existing);return [204,null] }
  if (!(method==='POST' && !id || method==='PUT' && existing)) return [405,{message:'Unsupported action'}]
  const stamp = new Date().toISOString()
  const c = existing ? {...existing} : {...make('',[],[]),id:randomUUID(),createdAt:stamp,nextDirectionTag:1}
  for (const key of ['name','enabled','hideHopsFromSub','autoProfile']) if (body[key]!==undefined) c[key]=body[key]
  if (!c.name?.trim() || scene.cascades.some(v=>v.id!==c.id&&v.name===c.name)) return [409,{message:'A unique name is required'}]
  if (body.positions || body.directions || !existing) {
    if (!Array.isArray(body.positions)||!body.positions.length||!Array.isArray(body.directions)||!body.directions.length) return [400,{message:'Entry and exit required'}]
    c.positions=body.positions
    c.directions=body.directions.map(d=>{
      const old = c.directions.find(x=>x.id===d.id)
      return {...(old??dir(randomUUID(),c.nextDirectionTag++,d.countryCode,[])),...d}
    })
  }
  c.updatedAt=stamp
  if (existing) scene.cascades[scene.cascades.indexOf(existing)]=c
  else scene.cascades.push(c)
  return [existing?200:201,c]
}
