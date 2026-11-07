// The CSP of nginx.conf.template against the real bundle, in Chromium, on every push (ARCH
// 2026-11-06). A library update can add a <style> without the nonce, and the browser would
// refuse it with only the console to say so. Serves dist with the header nginx sends and
// the nonce nginx writes, walks the screens, and fails on any violation.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'

const dist = process.argv[2] ?? 'dist'
const template = readFileSync('nginx.conf.template', 'utf8')
const match = template.match(/set \$csp_spa "([^"]+)"/)
if (!match) {
  console.log('::error::csp-guard: $csp_spa is not in nginx.conf.template')
  process.exit(1)
}
const policyTemplate = match[1]

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const ADMIN = { id: '1', username: 'admin', role: 'admin' }

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname.startsWith('/api/')) {
    const body = { '/api/auth/status': { registration: { enabled: false } }, '/api/auth/me': ADMIN }[pathname]
    res.writeHead(body ? 200 : 500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? {}))
    return
  }
  const file = join(dist, pathname)
  if (existsSync(file) && statSync(file).isFile() && extname(file) !== '.html') {
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
    return
  }
  const nonce = randomBytes(16).toString('hex')
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Content-Security-Policy': policyTemplate.replaceAll('$request_id', nonce) })
  res.end(readFileSync(join(dist, 'index.html'), 'utf8').replace('__CSP_NONCE__', nonce))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.addInitScript(() => {
  window.__violations = []
  document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`))
})

const failures = []
for (const path of process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['/login', '/']) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  const violations = await page.evaluate(() => window.__violations)
  const applied = await page.evaluate(() => [...document.querySelectorAll('style')].every((s) => s.sheet !== null))
  console.log(`${path}: ${violations.length} violations, style tags applied: ${applied}`)
  for (const v of violations) failures.push(`${path}: ${v}`)
  if (!applied) failures.push(`${path}: a <style> tag was refused`)
}

await browser.close()
server.close()

for (const f of failures) console.log(`::error::csp-guard: ${f}`)
process.exit(failures.length > 0 ? 1 : 0)
