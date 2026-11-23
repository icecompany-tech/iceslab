import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { nativeEngineFor } from '../../../../packages/shared/src/adapters.ts'
import { readPanel } from './panel-review.mjs'

const snapshot = JSON.parse(readFileSync(new URL('../../../../packages/shared/src/recipes.snapshot.json', import.meta.url), 'utf8'))
const recipes = snapshot.recipes.map((recipe) => ({ ...recipe, sourceId: 'builtin' }))
const editable = ['name', 'description', 'enabled', 'config', 'engine', 'awgProtocol', 'reviewInbound', 'reviewDocument']

export function newProfileReview() {
  const { profiles } = readPanel(new URL('http://localhost/api/profiles'))
  return { profiles: structuredClone(profiles), created: new Set(), hidden: [] }
}

export function profileReviewReply(state, method, url, body) {
  const path = url.pathname
  if (path === '/api/recipes/registry' && method === 'GET') {
    return [200, { recipes, hidden: state.hidden, stale: false }]
  }
  if (path === '/api/recipes/hidden' && method === 'PUT' && Array.isArray(body.ids)) {
    state.hidden = recipes.filter((recipe) => body.ids.includes(recipe.id)).map((recipe) => recipe.id)
    return [200, { hidden: state.hidden }]
  }
  if (path === '/api/profiles/generate-keypair' && method === 'POST') {
    const pair = generateKeyPairSync('x25519')
    const encode = (key) => url.searchParams.get('protocol') === 'amneziawg' ? Buffer.from(key, 'base64url').toString('base64') : key
    return [200, { privateKey: encode(pair.privateKey.export({ format: 'jwk' }).d), publicKey: encode(pair.publicKey.export({ format: 'jwk' }).x) }]
  }
  const parts = path.split('/')
  if (parts[2] !== 'profiles') return null
  const [, , , id, action] = parts
  const profiles = state.profiles
  const row = profiles.find((profile) => profile.id === id)
  if (method === 'GET' && !id) return [200, { profiles, reviewConsole: true }]
  if (id && !row) return [404, { error: 'NOT_FOUND' }]
  if (method === 'POST' && action === 'test-connect' && state.created.has(id)) return [200, { results: [] }]
  if (method === 'GET' && action === 'key-impact' && state.created.has(id)) {
    return [200, { hosts: 0, nodes: 0, bindings: 0, users: 0, configs: 0 }]
  }
  if (action) return null
  if (method === 'DELETE' && state.created.has(id)) {
    profiles.splice(profiles.indexOf(row), 1)
    state.created.delete(id)
    return [204, null]
  }
  const creating = !id && method === 'POST'
  if (!creating && !(row && method === 'PUT')) return null
  if ((creating || Object.hasOwn(body, 'name')) && (typeof body.name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(body.name))) {
    return [400, { message: 'Укажите имя латиницей.' }]
  }
  if (profiles.some((profile) => profile !== row && profile.name === body.name)) {
    return [409, { error: 'CONFLICT', message: 'Профиль с таким именем уже существует.' }]
  }
  if (creating && (!body.config || typeof body.protocol !== 'string')) return [400, { error: 'INVALID_PROFILE' }]
  const now = new Date().toISOString()
  const saved = row ?? { id: randomUUID(), protocol: body.protocol, config: {}, engine: null, description: null, enabled: true, bindingCount: 0, userCount: 0, createdAt: now }
  for (const field of editable) if (Object.hasOwn(body, field)) saved[field] = body[field]
  saved.updatedAt = now
  saved.effectiveEngine = saved.engine ?? nativeEngineFor(saved.protocol)
  if (creating) {
    profiles.push(saved)
    state.created.add(saved.id)
  }
  return [creating ? 201 : 200, saved]
}
