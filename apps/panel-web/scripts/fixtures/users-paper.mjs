// Synthetic values from the two registry frames and the new-user form.
export const clock = new Date('2026-11-04T11:00:00Z')
const GIB = 1024 ** 3
const day = 86_400_000
const instant = (days) => new Date(clock.getTime() + days * day).toISOString()
const allId = '00000000-0000-0000-0000-000000000001'

// name, short ID, status, last node, days since last connection, days to expiry, used GiB, limit GiB
const rows = [
  ['alex_dev', '4a7c19', 'active', 'de-01', 0, 33, 6.8, 100],
  ['anna', '9b2e77', 'expired', 'nl-02', 3, -3, 12.4, 50],
  ['boris', 'a7f3c1', 'active', 'se-01', 0, 24, 4.2, null],
  ['dmitry', 'e05a3d', 'disabled', 'nl-02', 6, 60, 33.9, null],
  ['gaming-pc', '2d84f0', 'expired', 'de-01', 20, -20, 88.1, 100],
  ['home-router', 'bb0947', 'active', 'se-01', 0, 210, 512, 1024],
  ['ilya', '40de81', 'active', 'de-01', 5 / 1440, 71, 47.5, 100],
  ['kate_m', '8d3f24', 'active', 'nl-02', 0, 6, 39, 50],
  ['lena_v', 'c1d9a2', 'limited', 'se-01', 2 / 24, 19, 50, 50],
  ['mira_s', 'f6a013', 'active', null, null, 30, 0, 50],
  ['nastya', '7e21b0', 'active', 'de-01', 0, 33, 6.8, 100],
  ['oleg_home', 'c03f5a', 'active', 'se-01', 0, 210, 512, 1024],
  ['petr', '91ab4e', 'active', 'de-01', 5 / 1440, 71, 47.5, 100],
]
const users = rows.map(([username, shortId, status, node, age, term, used, limit]) => ({
  id: 'sample-' + shortId, username, shortId, status, expireAt: instant(term),
  trafficUsedBytes: Math.round(used * GIB), trafficLimitBytes: limit === null ? null : limit * GIB,
  lifetimeTrafficBytes: Math.round(used * GIB), trafficLimitStrategy: 'month', lastTrafficResetAt: null,
  lastOnlineAt: age === null ? null : instant(-age), firstConnectedAt: node ? instant(-32) : null,
  lastConnectedNodeId: node, lastConnectedNodeName: node, subscriptionToken: 'local-example-' + shortId,
  subRevokedAt: null, hwidDeviceLimit: null, description: null, tag: null, telegramId: null,
  email: null, groupIds: ['basic'], createdAt: instant(-60),
}))
const nodes = ['de-01', 'se-01', 'nl-02'].map((name) => ({
  id: name, name, address: 'example.invalid', status: 'online', countryCode: name.slice(0, 2).toUpperCase(),
  lastStatusChange: null, lastStatusMessage: null,
}))
const profiles = ['vless', 'hy2', 'awg'].map((protocol) => ({ id: protocol, protocol }))
const bindings = [
  ['de-01', 'vless', 443], ['de-01', 'hy2', 8443], ['se-01', 'vless', 443],
  ['se-01', 'awg', 51820], ['nl-02', 'vless', 443], ['nl-02', 'hy2', 8443],
].map(([nodeId, profileId, port], i) => ({ id: 'binding-' + i, enabled: true, nodeId, profileId, port }))
const basic = {
  id: 'basic', name: 'basic', memberCount: 1, description: null, hostIds: [],
  profileIds: profiles.map((p) => p.id), hwidDeviceLimit: null, routingPreset: 'ru-split', customRoutingPresetId: null,
}
const overview = {
  users: { total: 1358, byStatus: { active: 1204, expired: 96, limited: 21, disabled: 37 }, onlineNow: 3, onlineToday: 4 },
  traffic: { todayBytes: 0, yesterdayBytes: 0, last7dBytes: 0, prev7dBytes: 0, last30dBytes: 0, prev30dBytes: 0, calendarMonthBytes: 0, currentYearBytes: 0, last24hHourly: [] },
  system: { onlineNodeCount: 3, totalNodeCount: 4 }, inventory: { profileCount: 3, squadCount: 2, hostCount: 0 },
  host: null, nodes: [{ ...nodes[0], id: 'spare', status: 'offline', inboundCount: 0, todayBytes: 0 }],
}
const api = {
  '/api/auth/me': { id: 'sample-admin', username: 'admin', role: 'admin' },
  '/api/auth/status': { registration: { enabled: false }, panel: { publicUrl: 'https://example.invalid', subscriptionPathPrefix: '/sub' } },
  '/api/settings/public': {}, '/api/system/version': { current: '0.4.0+dev', latest: null, releaseUrl: null, stars: 19, updateAvailable: false },
  '/api/dashboard/overview': overview, '/api/nodes': { nodes, total: nodes.length },
  '/api/squads': { squads: [{ ...basic, id: allId, name: 'All', profileIds: [], routingPreset: null }, basic] },
  '/api/profiles': { profiles }, '/api/bindings': { bindings }, '/api/hosts': { hosts: [] }, '/api/users/tags': { tags: [] },
  '/api/audit': { events: [], nextCursor: null }, '/api/cascades': { cascades: [], fields: [] },
  '/api/route-policies': { policies: [] }, '/api/named-outbounds': { outbounds: [] },
  '/api/geo-sets': { geoSets: [{ id: 'geo', name: 'geoip', kind: 'geoip', format: 'dat', status: 'verified',
    source: { type: 'builtin', tag: 'example' }, checkedAt: instant(0), error: null, usedByRules: 0, nodes: { total: 0, behind: 0 },
    current: { version: 'v2', sha256: 'example', sourceSha256: 'example', sizeBytes: 10, fetchedAt: instant(0), tagCount: 1 },
    createdAt: instant(-1), updatedAt: instant(0) }] },
}

export function fixture(url, count, creating) {
  if (url.pathname !== '/api/users') return api[url.pathname]
  // The form frame predates kate_m. The registry frames already contain this user.
  let page = users.slice(0, count).filter((user) => !creating || user.username !== 'kate_m')
  const search = url.searchParams.get('search')
  const expiry = url.searchParams.get('hasExpiry')
  if (search) page = page.filter((user) => user.username.includes(search))
  if (expiry) page = page.filter((user) => (user.expireAt !== null) === (expiry === 'yes'))
  return { users: page, total: search || expiry ? page.length : overview.users.total }
}
