import { newCascadeReview, readCascadeReview, writeCascadeReview } from './fixtures/cascades-paper.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { newReviewUsers, reviewUsersReply } from './fixtures/review-users.mjs'
import { newHostReview, hostReviewReply } from './fixtures/hosts-paper.mjs'
import { newProfileReview, profileReviewReply } from './fixtures/profiles-paper.mjs'
import { newOverviewReview, overviewReviewReply } from './fixtures/overview-paper.mjs'
import { createReviewNode, newNodesReview, nodesReviewReply } from './fixtures/nodes-paper.mjs'
import { readPanel } from './fixtures/panel-review.mjs'

const mediaTypes = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const routes = /^\/(?:login|users|squads|profiles|hosts|nodes|cascades|routes|outbounds|geo|devices|requests|audit|settings|account|subscription\/(?:delivery|templates|params))(?:\/[\w-]+)*$/
const previewRoutes = new Set(["/subscription/page","/rule-sets","/dns","/torrents","/sessions","/http-stats","/admin/queues"])
const template = readFileSync(new URL('../nginx.conf.template', import.meta.url), 'utf8')
const policy = template.match(/set \$csp_spa "([^"]+)"/)?.[1]
if (!policy) throw Error('Panel CSP is missing from nginx.conf.template')

// All requests terminate in this local process. Changes to demo users live in the requesting browser's session.
export function createReviewServer(dist, publicPages, hostsEnabled = false, profilesEnabled = false, overviewEnabled = false, nodesEnabled = false) {
  const index = readFileSync(join(dist, 'index.html'), 'utf8')
  const sessions = new Map()
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    res.setHeader('Cache-Control', 'no-store')
    const cookie = /(?:^|; )paper-review=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    let session = cookie && sessions.get(cookie)
    if (!session && (path === '/' || (routes.test(path) || previewRoutes.has(path)) || path.startsWith('/api/'))) {
      const id = randomBytes(16).toString('hex')
      session = { users: newReviewUsers(), signedIn: true, hosts: hostsEnabled ? newHostReview() : null, profiles: profilesEnabled ? newProfileReview() : null }
      if (nodesEnabled) session.nodeScene = newNodesReview()
      if (overviewEnabled) {
        session.overview = newOverviewReview()
        session.users = session.overview.rows
      }
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value)
      sessions.set(id, session)
      res.setHeader('Set-Cookie', 'paper-review=' + id + '; HttpOnly; SameSite=Strict; Path=/')
    }
    if (session?.hosts && path === '/hosts' && url.searchParams.has('demo')) {
      session.hosts.offline = url.searchParams.get('demo') === 'offline'
    }
    if (session?.overview && path === '/' && ['normal', 'empty', 'traffic-error'].includes(url.searchParams.get('demo'))) {
      session.overview = newOverviewReview(url.searchParams.get('demo'))
      session.users = session.overview.rows
    }
    if (session?.nodeScene && (path === '/nodes' || path === '/cascades') && ['empty','normal'].includes(url.searchParams.get('demo'))) {
      session.nodeScene = newNodesReview(url.searchParams.get('demo') === 'empty')
    }
    if (session?.nodeScene && path === '/nodes/new' && ['file','https','agent'].includes(url.searchParams.get('install'))) {
      session.nodeScene = newNodesReview(true)
      session.nodeScene.install = url.searchParams.get('install')
    }
    if (nodesEnabled && session && path === '/cascades' && url.searchParams.get('demo') === 'registry') {
      if (!session.nodeScene?.squads) session.nodeScene = newCascadeReview()
    }
    const cascadeWrite = session?.nodeScene?.squads && /^\/api\/cascades(?:\/[\w-]+)?$/.test(path) && ['POST','PUT','DELETE'].includes(req.method)
    // Hosts and nodes have separate synthetic fleets. A host page must use its own bindings and fleet.
    const hostRoute = hostsEnabled && /^\/api\/(?:hosts|nodes|profiles|bindings)(?:\/|$)/.test(path)
    let fromHosts = false
    if (hostRoute && req.headers.referer) {
      try { fromHosts = /^\/hosts(?:\/|$)/.test(new URL(req.headers.referer).pathname) } catch { /* No referring page. */ }
    }
    const nodeCreate = session?.nodeScene && path === '/api/nodes' && req.method === 'POST'
    if (!fromHosts && session?.nodeScene && session.signedIn && req.method === 'GET') {
      const result = (session.nodeScene.squads && readCascadeReview(session.nodeScene, path)) ?? nodesReviewReply(session.nodeScene, path, url.searchParams)
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result))
        return
      }
    }
    const overviewRoute = session?.overview && ['/api/dashboard/overview', '/api/nodes'].includes(path)
    const profileRoute = profilesEnabled && /^\/api\/(?:profiles|recipes)(?:\/|$)/.test(path)
    const accountRoute = ['/api/auth/me', '/api/auth/login', '/api/auth/logout'].includes(path)
    if (session && (cascadeWrite || nodeCreate || overviewRoute || profileRoute || hostRoute || accountRoute || path.startsWith('/api/users') || path === '/api/dashboard/overview')) {
      let body = {}
      if (['POST', 'PUT'].includes(req.method) || ((profileRoute || cascadeWrite) && req.method === 'DELETE')) {
        const addresses = ['127.0.0.1', 'localhost'].map((host) => 'http://' + host + ':' + req.socket.localPort)
        const emptyProfileAction = (cascadeWrite && req.method === 'DELETE') || profileRoute && (req.method === 'DELETE' || (req.method === 'POST' && (path === '/api/profiles/generate-keypair' || /^\/api\/profiles\/[\w-]+\/test-connect$/.test(path))))
        if (!addresses.includes(req.headers.origin) || (path !== '/api/auth/logout' && !emptyProfileAction && !req.headers['content-type']?.startsWith('application/json'))) {
          res.writeHead(403).end()
          return
        }
        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 64 * 1024) {
              res.writeHead(413).end()
              return
            }
            chunks.push(chunk)
          }
          if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid object')
        } catch {
          res.writeHead(400).end()
          return
        }
      }
      let reply
      if (req.method === 'POST' && path === '/api/auth/login') {
        if (body.username !== 'admin' || body.password !== 'paper-demo') reply = [401, { error: 'INVALID_CREDENTIALS' }]
        else if (!body.totpCode) reply = [401, { error: 'TOTP_REQUIRED' }]
        else if (body.totpCode !== '418205') reply = [401, { error: 'INVALID_TOTP' }]
        else {
          session.signedIn = true
          reply = [200, { admin: readPanel(new URL('/api/auth/me', url)) }]
        }
      } else if (req.method === 'POST' && path === '/api/auth/logout') {
        session.signedIn = false
        res.writeHead(204).end()
        return
      } else if (!session.signedIn) reply = [401, { error: 'UNAUTHORIZED' }]
      else if (cascadeWrite) reply = writeCascadeReview(session.nodeScene, req.method, path, body)
      else if (nodeCreate) reply = createReviewNode(session.nodeScene, body)
      else if (fromHosts) reply = hostReviewReply(session.hosts, req.method, url, body)
      else if (overviewRoute && req.method === 'GET') reply = overviewReviewReply(session.overview, url)
      else if (profileRoute) reply = profileReviewReply(session.profiles, req.method, url, body)
      else if (hostRoute) reply = hostReviewReply(session.hosts, req.method, url, body)
      else reply = reviewUsersReply(session.users, req.method, url, body)
      if (reply) {
        res.writeHead(reply[0], { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(reply[1]))
        return
      }
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Просмотр на тестовых данных. Запись отключена.' }))
      return
    }
    if (path === '/api/settings/subscription/preview-url' && publicPages) {
      if (!session?.signedIn) {
        res.writeHead(401).end()
        return
      }
      const state = url.searchParams.get('state') ?? 'active'
      const lang = url.searchParams.get('lang') ?? 'ru'
      if (!['active', 'expiring', 'expired', 'limited', 'disabled'].includes(state) || !['ru', 'en'].includes(lang)) {
        res.writeHead(400).end()
        return
      }
      const available = existsSync(join(publicPages, state + '-' + lang + '.html'))
      const preview = available ? '/api/settings/subscription/preview/review-' + state + '?lang=' + lang : null
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ url: preview }))
      return
    }
    const previewPage = /^\/api\/settings\/subscription\/preview\/review-(active|expiring|expired|limited|disabled)$/.exec(path)
    if (previewPage && publicPages) {
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ru'
      const html = join(publicPages, previewPage[1] + '-' + lang + '.html')
      if (existsSync(html)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' }).end(readFileSync(html))
        return
      }
    }
    if (path === '/health' || path.startsWith('/api/')) {
      const body = readPanel(url)
      res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body ?? { message: 'Для этого запроса нет тестовых данных.' }))
      return
    }
    const subscription = /^\/sub\/review-(active|expired|limited|disabled|revoked)$/.exec(path)
    if (subscription && publicPages && !url.searchParams.has('format')) {
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ru'
      const html = join(publicPages, subscription[1] + '-' + lang + '.html')
      if (existsSync(html)) {
        res.writeHead(subscription[1] === 'active' ? 200 : 403, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' }).end(readFileSync(html))
        return
      }
    }
    if (path === '/' || (routes.test(path) || previewRoutes.has(path))) {
      const nonce = randomBytes(16).toString('hex')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy.replaceAll('$request_id', nonce) })
      res.end(index.replace('__CSP_NONCE__', nonce))
      return
    }
    const file = join(dist, path)
    if (/^\/(?:assets\/[\w.-]+|favicon\.svg)$/.test(path) && existsSync(file)) {
      res.writeHead(200, { 'Content-Type': mediaTypes[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
      return
    }
    res.writeHead(404).end()
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createReviewServer(resolve(process.argv[2] ?? 'dist'), process.argv[4], process.argv.includes('--hosts'), process.argv.includes('--profiles'), process.argv.includes('--overview'), process.argv.includes('--nodes'))
  const port = Number(process.argv[3] ?? 4175)
  server.listen(port, '127.0.0.1', () => console.log('Blackhole / synthetic review: http://127.0.0.1:' + server.address().port + '/users'))
}
