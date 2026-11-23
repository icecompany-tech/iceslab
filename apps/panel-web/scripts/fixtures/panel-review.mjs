import { fixture } from './users-paper.mjs'

const date = '2026-11-04T11:00:00Z'
const fromUsers = (path) => fixture(new URL(path, 'http://localhost'), 13, false)
const nodes = fromUsers('/api/nodes').nodes.map((node) => ({
  ...node, protocol: 'xray', engines: ['xray'], regionId: null, consumptionMultiplier: 1,
  address: node.name + '.example.invalid:1337', certNotAfter: '2027-01-01T00:00:00Z',
}))
const profiles = ['vless', 'hy2', 'awg'].map((id, i) => ({
  id, name: id + '-1', protocol: ['xray', 'hysteria', 'amneziawg'][i],
  effectiveEngine: ['xray', 'hysteria', 'amneziawg'][i], config: {}, description: null, enabled: true,
  awgProtocol: null, bindingCount: [3, 2, 1][i], userCount: [612, 131, 84][i],
}))
const bindings = fromUsers('/api/bindings').bindings
const hosts = bindings.map((binding, i) => ({
  id: 'host-' + i, bindingId: binding.id, remark: binding.nodeId + ' / ' + binding.profileId,
  enabled: true, addressOverride: null, isHidden: false, hiddenByCascade: null, disableForFormats: [], alpn: [],
  securityLayer: 'default', allowInsecure: false, reach: { squads: 2, users: 612 },
}))
const squads = [
  ['All', 1358, 'Новые юзеры попадают сюда сами'], ['basic', 612, 'Платный тариф, вход RU и один выход'],
  ['business', 84, 'Корпоративные клиенты'], ['family', 131, 'Семейный тариф'],
  ['mobile', 207, 'Только мобильные протоколы'], ['premium', 248, 'Все протоколы и все выходы'],
  ['reseller', 3, 'Партнёрские аккаунты'], ['stage', 4, 'Проверка новых нод'], ['trial', 96, 'Пробный доступ на неделю'],
].map(([name, memberCount, description], i) => ({
  id: i === 0 ? fromUsers('/api/squads').squads[0].id : name, name, memberCount, description,
  profileIds: i === 6 ? [] : profiles.slice(0, i === 0 ? profiles.length : i % 3 + 1).map((p) => p.id),
  hostIds: i === 1 ? [hosts[0].id] : [], exitAcl: [], policyIds: [], routingPreset: i === 1 ? 'ru-split' : null,
  customRoutingPresetId: null, hwidDeviceLimit: null, createdAt: date, updatedAt: date,
}))
const cascade = {
  id: 'ams-fra', name: 'Амстердам-Франкфурт', enabled: true, mode: 'chain', hideHopsFromSub: true,
  autoProfile: true, hops: [], entryPolicy: null, nextDirectionTag: 8, createdAt: date, updatedAt: date,
  positions: [{ position: 0, nodeIds: ['nl-02'], entryProtocol: 'xray', linkProtocol: 'vless', linkParams: null }],
  directions: [{ id: 'fra', tag: 5, countryCode: 'DE', nodeIds: ['de-01'], outboundId: null, linkProtocol: null, linkParams: null, linkPort: 24001 }],
}
const outbounds = [
  ['de-reality', 'vless', 'de.partner.example.net', 443, 'DE', 5], ['nl-socks', 'socks', '185.12.4.7', 1080, 'NL', 7],
  ['corp-proxy', 'socks', 'proxy.corp.example.com', 1080, null, null], ['old-direct', 'freedom', null, null, null, null],
].map(([name, type, server, port, countryCode, tag]) => ({
  id: name, name, type, countryCode, config: server ? { server, port } : {},
  usedBy: tag ? [{ cascadeId: cascade.id, cascadeName: cascade.name, directionTag: tag }] : [], createdAt: date, updatedAt: date,
}))
const geoSets = [
  ['geosite', 'geosite', 'dat', 'verified', '20261104', 1430, 6, 4, 0, { type: 'builtin', tag: '20261104' }],
  ['geoip', 'geoip', 'dat', 'verified', '20261104', 252, 4, 4, 2, { type: 'builtin', tag: '20261104' }],
  ['ru-lists', 'geosite', 'dat', 'broken', '20261102', 86, 2, 2, 0, { type: 'url', url: 'https://lists.example.net/ru.dat', refreshHours: 24, sha256Source: 'sidecar' }],
  ['ads-block', 'rule-set', 'json', 'verified', '20260930', 1, 1, 1, 0, { type: 'upload', filename: 'ads.json' }],
  ['my-ips', 'mmdb', 'mmdb', 'broken', null, null, 0, 0, 0, { type: 'url', url: 'https://geo.example.net/my.mmdb', refreshHours: 168, sha256Source: 'manual' }],
  ['asn-lists', 'geoip', 'dat', 'checking', null, null, 0, 0, 0, { type: 'upload', filename: 'asn.dat' }],
].map(([name, kind, format, status, version, tagCount, usedByRules, total, behind, source]) => ({
  id: name, name, kind, format, status, source, checkedAt: date, error: status === 'broken' ? 'checksum mismatch' : null,
  usedByRules, nodes: { total, behind }, current: version && { version, tagCount, sha256: 'sample', sourceSha256: 'sample', sizeBytes: 1024, fetchedAt: date },
  createdAt: date, updatedAt: date,
}))
const policyRules = [
  ['geosite:category-ads-all', 'block'], ['geosite:google', 'warp'], ['geosite:ru', 'direct'], ['geosite:youtube', 'warp'],
].map(([domain, kind], i) => ({
  id: 'rule-' + i, position: i, enabled: true, match: { domain: [domain], ip: i === 2 ? ['geoip:private'] : [], port: null, protocol: [], network: null },
  action: { kind, directionId: null }, shadowedBy: i === 3 ? { id: 'rule-1', position: 1 } : null,
}))
const policies = [['Без рекламы', 4, 2], ['RU напрямую', 2, 1], ['Через WARP', 1, 0]].map(([name, n, nodeCount], i) => ({
  id: 'policy-' + i, name, nodeCount, rules: policyRules.slice(0, n), description: null, createdAt: date, updatedAt: date,
}))
const rules = [
  ['Hiddify', '(?i)hiddify', 'singbox'], ['Streisand', '(?i)streisand', 'xrayjson'], ['Happ', '(?i)happ', 'xrayjson-array'],
  ['Семейство Clash', '(?i)(clash|stash|mihomo)', 'mihomo'], ['Catch-all', '.*', 'plain'],
].map(([name, uaPattern, format], i) => ({
  id: 'srr-' + i, priority: i + 1, name, uaPattern, format, enabled: i !== 3, templateName: i === 2 ? 'Happ с группами' : null, createdAt: date, updatedAt: date,
}))
const overview = fromUsers('/api/dashboard/overview')
const api = {
  '/health': { status: 'ok', db: 'ok', redis: 'ok' },
  '/api/nodes': { nodes, total: nodes.length }, '/api/profiles': { profiles: [...profiles, { ...profiles[0], id: 'ru-reality', name: 'ru-reality', description: 'Вход из России, под Cloudflare', bindingCount: 3, userCount: 1204 }] }, '/api/hosts': { hosts }, '/api/squads': { squads },
  '/api/profile-node-bindings': { bindings }, '/api/cascades': { cascades: [cascade], fields: ['entryPolicy'] },
  '/api/cascades/ams-fra/status': { done: true, broken: null, hops: [] }, '/api/named-outbounds': { outbounds },
  '/api/node-policies': { policies }, '/api/geo-sets': { geoSets }, '/api/srr': { rules },
  '/api/routing-presets': { presets: ['proxy-all', 'ru-split'].map((id) => ({ id, name: id, builtIn: true, rules: [] })) },
  '/api/settings': { brandName: 'IceSLab', subscriptionUpdateIntervalHours: 24, subscriptionRoutingPreset: 'proxy-all', subscriptionDefaultFormat: 'plain', subscriptionLinkShape: 'per-exit', subscriptionPathPrefix: '/sub' },
  '/api/settings/subscription/preview-url': { url: null },
  '/api/regions': { regions: [] }, '/api/recipes/sources': { sources: [] }, '/api/recipes/registry': { recipes: [] },
  '/api/subscription-templates': { templates: [{ id: 'default', type: 'mihomo', name: 'Default', body: '', isDefault: true, updatedAt: date }] },
  '/api/api-tokens': { tokens: [] }, '/api/auth/2fa/status': { enabled: false },
  '/api/dashboard/overview': { ...overview, system: { onlineNodeCount: 3, totalNodeCount: 3 }, inventory: { profileCount: profiles.length, squadCount: squads.length, hostCount: hosts.length }, nodes: nodes.map((node) => ({ ...node, todayBytes: 0, inboundCount: bindings.filter((b) => b.nodeId === node.id).length })) },
  '/api/dashboard/insights': { windowDays: 7, subRequests: { total: 0, uniqueUsers: 0, byClient: [], byHourUtc: [] }, hwid: { totalDevices: 9, usersWithDevices: 3, avgDevicesPerUser: 3, distribution: [{ bucket: '1', users: 1 }, { bucket: '2', users: 1 }, { bucket: '5+', users: 1 }], atOrOverLimit: 1 } },
}

export function readPanel(url) {
  if (url.pathname === '/api/users' && url.searchParams.has('expiresBefore')) {
    const start = Date.parse(url.searchParams.get('expiresAfter') ?? '')
    const end = Date.parse(url.searchParams.get('expiresBefore'))
    const users = fromUsers('/api/users').users.filter((user) => {
      const expires = Date.parse(user.expireAt)
      return user.status === 'active' && expires >= start && expires <= end
    })
    return { users: users.slice(0, Number(url.searchParams.get('limit') ?? users.length)), total: users.length }
  }
  if (Object.hasOwn(api, url.pathname)) return api[url.pathname]
  return fixture(url, 13, false)
}
