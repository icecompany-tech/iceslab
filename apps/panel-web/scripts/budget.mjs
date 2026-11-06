// Weight budgets of the bundle, gzip (01-target.md, "Бюджеты в CI"), and no web fonts
// (codex F7). Exits non-zero over a budget and on a dist it cannot read: a missing
// report is a broken run, not a pass.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const LIMITS = { entryKb: 120, totalJsKb: 350 }

const FONT = /\.(woff2?|ttf|otf|eot)$/i

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )

const gzipKb = (file) => gzipSync(readFileSync(file), { level: 9 }).length / 1024

/** What the first page load has to fetch: the module script and its modulepreloads. */
export function entryFiles(html) {
  const refs = [
    ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g),
    ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+\.js)"/g),
  ]
  return refs.map((m) => m[1].replace(/^\//, ''))
}

export function measure(dist) {
  const index = join(dist, 'index.html')
  if (!existsSync(index)) throw new Error(`${index} is missing, nothing was built`)
  const entry = entryFiles(readFileSync(index, 'utf8'))
  if (entry.length === 0) throw new Error(`${index} names no script`)

  const files = walk(dist)
  const js = files.filter((f) => f.endsWith('.js'))
  return {
    entryKb: entry.reduce((sum, f) => sum + gzipKb(join(dist, f)), 0),
    totalJsKb: js.reduce((sum, f) => sum + gzipKb(f), 0),
    cssKb: files.filter((f) => f.endsWith('.css')).reduce((sum, f) => sum + gzipKb(f), 0),
    fonts: files.filter((f) => FONT.test(f)).map((f) => relative(dist, f).split(sep).join('/')),
  }
}

export function refusals(m, limits = LIMITS) {
  const out = []
  if (m.entryKb > limits.entryKb) out.push(`entry ${m.entryKb.toFixed(1)} KB over ${limits.entryKb} KB`)
  if (m.totalJsKb > limits.totalJsKb) out.push(`js ${m.totalJsKb.toFixed(1)} KB over ${limits.totalJsKb} KB`)
  if (m.fonts.length > 0) out.push(`web fonts in the bundle: ${m.fonts.join(', ')}`)
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let m
  try {
    m = measure(process.argv[2] ?? 'dist')
  } catch (err) {
    console.log(`::error::budget: ${err.message}`)
    process.exit(1)
  }
  const line = `entry ${m.entryKb.toFixed(1)}/${LIMITS.entryKb} KB, js ${m.totalJsKb.toFixed(1)}/${LIMITS.totalJsKb} KB, css ${m.cssKb.toFixed(1)} KB, fonts ${m.fonts.length} (gzip -9)`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- budget: ${line}\n`)
  const refused = refusals(m)
  for (const r of refused) console.log(`::error::budget: ${r}`)
  process.exit(refused.length > 0 ? 1 : 0)
}
