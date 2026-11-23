import { randomUUID } from 'node:crypto'
import { ONLINE_WINDOW_MS } from '../../../../packages/shared/src/presence.ts'
import { clock } from './users-paper.mjs'
import { readPanel } from './panel-review.mjs'

const path = (name) => new URL(name, 'http://localhost')
const original = readPanel(path('/api/users')).users
const sortFields = { username: 'username', expireAt: 'expireAt', traffic: 'trafficUsedBytes', lastOnline: 'lastOnlineAt', firstConnected: 'firstConnectedAt', lifetimeTraffic: 'lifetimeTrafficBytes' }

export function newReviewUsers() {
  return structuredClone(original)
}

function selectedUsers(rows, params) {
  const status = params.get('status')
  const search = params.get('search')?.toLowerCase()
  const filtered = rows.filter((u) => {
    if (search && !u.username.toLowerCase().includes(search) && !u.shortId.includes(search)) return false
    if (status && u.status !== status) return false
    if (params.has('nodeId') && (u.lastConnectedNodeId ?? 'none') !== params.get('nodeId')) return false
    if (params.has('online')) {
      const presence = !u.lastOnlineAt ? 'never' : clock.getTime() - Date.parse(u.lastOnlineAt) <= ONLINE_WINDOW_MS ? 'online' : 'offline'
      if (presence !== params.get('online')) return false
    }
    if (params.has('groupId') && !u.groupIds.includes(params.get('groupId'))) return false
    if (params.has('tag') && u.tag !== params.get('tag')) return false
    for (const [key, actual] of Object.entries({
      hasExpiry: u.expireAt ? 'yes' : 'no', hasTag: u.tag ? 'yes' : 'no', revoked: u.subRevokedAt ? 'yes' : 'no',
      trafficLimit: u.trafficLimitBytes === null ? 'unlimited' : 'limited',
      email: u.email ? 'set' : 'none', telegram: u.telegramId ? 'linked' : 'none',
      deviceLimit: u.hwidDeviceLimit === null ? 'unset' : u.hwidDeviceLimit === 0 ? 'unlimited' : 'set',
    })) if (params.has(key) && params.get(key) !== actual) return false
    for (const [key, instant] of [['expires', u.expireAt], ['created', u.createdAt], ['firstConnected', u.firstConnectedAt]]) {
      const after = params.get(key + 'After')
      const before = params.get(key + 'Before')
      if ((after || before) && !instant) return false
      if (after && Date.parse(instant) < Date.parse(after)) return false
      if (before && Date.parse(instant) > Date.parse(before)) return false
    }
    if (params.has('usedOver') && u.trafficUsedBytes < Number(params.get('usedOver'))) return false
    if (params.has('usedUnder') && u.trafficUsedBytes > Number(params.get('usedUnder'))) return false
    return true
  })
  const key = sortFields[params.get('sort')] ?? 'username'
  const direction = params.get('order') === 'desc' ? -1 : 1
  filtered.sort((a, b) => {
    const left = a[key] ?? '', right = b[key] ?? ''
    return (left < right ? -1 : left > right ? 1 : 0) * direction
  })
  const limit = Number(params.get('limit') ?? 25)
  const offset = (Number(params.get('page') ?? 1) - 1) * limit
  return { users: filtered.slice(offset, offset + limit), total: filtered.length }
}

const writeFields = ['status', 'groupIds', 'trafficLimitStrategy', 'expireAt', 'email', 'telegramId', 'hwidDeviceLimit', 'tag', 'description', 'routingPreset', 'customRoutingPresetId']
function updateRow(row, body) {
  for (const field of writeFields) if (Object.hasOwn(body, field)) row[field] = body[field]
  if (Object.hasOwn(body, 'trafficLimitGb')) row.trafficLimitBytes = body.trafficLimitGb === null ? null : body.trafficLimitGb * 1024 ** 3
}

function enabledStatus(user) {
  if (user.expireAt && Date.parse(user.expireAt) < clock.getTime()) return 'expired'
  if (user.trafficLimitBytes !== null && user.trafficUsedBytes >= user.trafficLimitBytes) return 'limited'
  return 'active'
}

export function reviewUsersReply(rows, method, url, body) {
  const route = url.pathname
  if (method === 'GET' && route === '/api/dashboard/overview') {
    const overview = readPanel(url)
    const byStatus = { active: 0, limited: 0, expired: 0, disabled: 0 }
    for (const user of rows) byStatus[user.status]++
    return [200, { ...overview, users: { ...overview.users, total: rows.length, byStatus } }]
  }
  if (method === 'GET' && route === '/api/users') return [200, selectedUsers(rows, url.searchParams)]
  if (method === 'POST' && route === '/api/users') {
    if (typeof body.username !== 'string' || !Array.isArray(body.groupIds)) return [400, { error: 'VALIDATION_ERROR' }]
    if (rows.some((u) => u.username === body.username)) return [409, { error: 'USERNAME_TAKEN', field: 'username' }]
    const id = randomUUID()
    const row = { ...original[0], id, shortId: id.slice(0, 6), username: body.username, status: 'active', subscriptionToken: body.subscriptionToken || 'local-example-' + id, createdAt: new Date().toISOString(),
      lastOnlineAt: null, firstConnectedAt: null, lastConnectedNodeId: null, lastConnectedNodeName: null, lifetimeTrafficBytes: 0, trafficUsedBytes: 0 }
    updateRow(row, body)
    rows.push(row)
    return [201, row]
  }
  if (method === 'POST' && route === '/api/users/bulk') {
    if (!Array.isArray(body.userIds) || !['enable', 'disable'].includes(body.action)) return [400, { error: 'VALIDATION_ERROR' }]
    const ok = [], failed = []
    for (const id of body.userIds) {
      const user = rows.find((u) => u.id === id)
      if (!user || user.username === 'anna') failed.push({ userId: id, error: user ? 'USER_CHANGED' : 'USER_NOT_FOUND' })
      else {
        user.status = body.action === 'disable' ? 'disabled' : enabledStatus(user)
        ok.push(id)
      }
    }
    return [200, { requested: body.userIds.length, succeeded: ok.length, ok, failed }]
  }
  const match = /^\/api\/users\/([^/]+)(?:\/(delivery|endpoints|hwid-devices))?$/.exec(route)
  if (!match || match[1] === 'tags') return null
  const row = rows.find((u) => u.id === match[1])
  if (!row) return [404, { error: 'USER_NOT_FOUND' }]
  if (method === 'PUT' && !match[2]) {
    updateRow(row, body)
    if (row.status !== 'disabled') row.status = enabledStatus(row)
    return [200, row]
  }
  if (method === 'GET') {
    if (match[2] === 'delivery') return [200, {}]
    if (match[2] === 'endpoints') return [200, { endpoints: [] }]
    if (match[2] === 'hwid-devices') return [200, { devices: [] }]
    return [200, row]
  }
  return null
}
