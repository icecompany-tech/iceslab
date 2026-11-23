const profiles = [
  ['ru-reality', 'xray'], ['awg-mobile', 'amneziawg'], ['hy2-mobile', 'hysteria'],
  ['naive-de', 'naive'], ['tg-proxy', 'mtproto'],
].map(([id, protocol]) => ({
  id, name: id, protocol, effectiveEngine: protocol, enabled: true, description: null,
  config: protocol === 'xray' ? {subprotocol: 'vless', network: 'raw', security: 'reality'} : {},
}))

const records = [
  ['Amsterdam', 'nl-ams-01', 443, 0, 1204, 2],
  ['Amsterdam mobile', 'nl-ams-01', 51820, 1, 612, 1],
  ['Amsterdam CDN', 'nl-ams-01', 8443, 0, 248, 1, 'cdn.example.net'],
  ['Stockholm', 'se-sto-01', 443, 0, 1204, 2],
  ['Frankfurt', 'de-fra-01', 8443, 0, 1204, 2],
  ['Frankfurt mobile', 'de-fra-01', 51820, 1, 612, 1],
  ['Frankfurt fast', 'de-fra-01', 443, 2, 207, 1],
  ['Запасной DE', 'de-fra-01', 443, 3, 248, 1, 'de.example.net'],
  ['Amsterdam exit', 'nl-ams-03', 443, 0, 0, 0],
  ['Telegram DE', 'de-fra-01', 2083, 4, 131, 1, 'cdn.example.net'],
  ['Amsterdam 2', 'nl-ams-01', 443, 0, 1204, 2],
  ['Amsterdam mobile 2', 'nl-ams-01', 51820, 1, 612, 1],
  ['Amsterdam CDN 2', 'nl-ams-01', 8443, 0, 248, 1, 'cdn.example.net'],
  ['Frankfurt 2', 'de-fra-01', 8443, 0, 1204, 2],
]
const bindings = records.map(([, nodeId, port, profile], index) => ({
  id: 'binding-' + index, nodeId, port, profileId: profiles[profile].id, transport: [1, 2].includes(profile) ? 'udp' : 'tcp',
}))
const formats = ['plain','raw','json','clash','mihomo','stash','clash-legacy','singbox','wgconf','amneziavpn','xrayjson','xrayjson-array','xkeen','outline','surge','quantumultx','loon']
export function newHostReview() {
  return {
    offline: false,
    since: new Date(Date.now() - 240000).toISOString(),
    rows: records.map(([remark, , , , users, squads, address], i) => ({
      id: 'host-' + i, bindingId: bindings[i].id, remark, priority: i, reach: {users, squads},
      serverDescription: i === 0 ? 'Быстрый, для видео' : null,
      enabled: i !== 9, isHidden: i === 7, hiddenByCascade: i === 8 ? {cascadeId:'a4-test',cascadeName:'a4-test'} : null,
      addressOverride: address ?? null, portOverride: null, disableForFormats: [], alpn: [], securityLayer: 'default', allowInsecure: false,
    })),
  }
}
export function hostReviewReply(state, method, url, body) {
  const path = url.pathname
  if (method === 'PUT' && path === '/api/hosts/reorder') {
    const byId = new Map(state.rows.map(row => [row.id, row]))
    const ids = body.hostIds
    if (!Array.isArray(ids) || ids.length !== byId.size || new Set(ids).size !== ids.length || !ids.every(id => byId.has(id))) {
      return [400, {error: 'INVALID_ORDER'}]
    }
    state.rows = ids.map((id, priority) => ({...byId.get(id), priority}))
    return [200, {hosts: state.rows}]
  }
  if (method !== 'GET') return null
  if (path === '/api/hosts') return [200, {hosts: state.rows}]
  if (path === '/api/bindings') return [200, {bindings}]
  if (path === '/api/profiles') return [200, {profiles}]
  if (path === '/api/nodes') {
    const nodes = [...new Set(bindings.map(b => b.nodeId))].map(id => {
      const down = id === 'se-sto-01' || (state.offline && id === 'nl-ams-01')
      return {id, name: id, countryCode: id.slice(0, 2).toUpperCase(), address: id + '.example.net:1337',
        status: down ? 'unreachable' : 'online', lastStatusChange: state.since, engines: ['xray','amneziawg','hysteria'], protocol:'xray'}
    })
    return [200, {nodes, total:nodes.length}]
  }
  if (path.endsWith('/host-fields')) return [200, {fields: {sniOverride:{supported:true}, alpn:{supported:true}}}]
  if (path.endsWith('/formats')) return [200, {formats: formats.map(format => {
    const carried = !['wgconf', 'amneziavpn', 'clash-legacy', 'outline', 'surge'].includes(format)
    return {format, carried, why: carried ? 'carried' : 'client-lacks-transport'}
  })}]
  return null
}
