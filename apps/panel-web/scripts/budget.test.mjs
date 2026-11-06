import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { closure, entryFiles, loginFiles, LOGIN_SCREEN, measure, refusals } from './budget.mjs'

let dist

const manifest = (body) => writeFileSync(join(dist, '.vite', 'manifest.json'), JSON.stringify(body))
const html = (body) => writeFileSync(join(dist, 'index.html'), body)
// Random bytes do not compress, so the size in an assertion is the size written.
const asset = (name, kb) => writeFileSync(join(dist, 'assets', name), randomBytes(kb * 1024))

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'budget-'))
  mkdirSync(join(dist, 'assets'))
  mkdirSync(join(dist, '.vite'))
  manifest({})
})

afterEach(() => rmSync(dist, { recursive: true, force: true }))

test('the entry is the module script with its modulepreloads', () => {
  assert.deepEqual(
    entryFiles(
      '<script type="module" crossorigin src="/assets/index-a.js"></script>' +
        '<link rel="modulepreload" crossorigin href="/assets/react-b.js">' +
        '<link rel="stylesheet" href="/assets/index-c.css">',
    ),
    ['assets/index-a.js', 'assets/react-b.js'],
  )
})

test('a missing build is an error, not a pass', () => {
  assert.throws(() => measure(join(dist, 'nope')), /nothing was built/)
})

test('an index without a script is an error, not an empty entry', () => {
  html('<div id="root"></div>')
  assert.throws(() => measure(dist), /names no script/)
})

test('a build without a manifest is an error: the login budget could not be read', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  asset('index.js', 1)
  rmSync(join(dist, '.vite', 'manifest.json'))
  assert.throws(() => measure(dist), /build\.manifest is off/)
})

test('a lazy chunk counts for the total and not for the entry', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  asset('index.js', 10)
  asset('lazy.js', 30)
  const m = measure(dist)
  assert.ok(m.entryKb > 9 && m.entryKb < 12, `entry ${m.entryKb}`)
  assert.ok(m.totalJsKb > 39 && m.totalJsKb < 43, `total ${m.totalJsKb}`)
})

test('the closure follows static imports and CSS, not dynamic imports, and survives a cycle', () => {
  const graph = {
    a: { file: 'a.js', css: ['a.css'], imports: ['b'], dynamicImports: ['lazy'] },
    b: { file: 'b.js', imports: ['a'] },
    lazy: { file: 'lazy.js' },
  }
  assert.deepEqual(closure(graph, ['a']).sort(), ['a.css', 'a.js', 'b.js'])
})

test('a chunk the manifest does not have is an error', () => {
  assert.throws(() => closure({ a: { file: 'a.js', imports: ['gone'] } }, ['a']), /no chunk gone/)
})

test('the login weight is the entry and the screen with what they import', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  asset('index.js', 10)
  asset('login.js', 20)
  asset('shared.js', 5)
  asset('other.js', 40)
  manifest({
    'index.html': { file: 'assets/index.js', isEntry: true, dynamicImports: [LOGIN_SCREEN, 'other'] },
    [LOGIN_SCREEN]: { file: 'assets/login.js', imports: ['_shared'] },
    _shared: { file: 'assets/shared.js' },
    other: { file: 'assets/other.js', imports: ['_shared'] },
  })
  const { loginKb } = measure(dist)
  assert.ok(loginKb > 34 && loginKb < 38, `login ${loginKb}`)
})

test('no login screen yet: not measured, and refuses nothing', () => {
  assert.equal(loginFiles({ 'index.html': { file: 'a.js', isEntry: true } }), null)
  assert.deepEqual(refusals({ entryKb: 1, totalJsKb: 1, loginKb: null, fonts: [] }), [])
})

test('each budget refuses on its own, and at the limit it passes', () => {
  const limits = { entryKb: 10, totalJsKb: 20, loginKb: 15 }
  const fine = { entryKb: 10, totalJsKb: 20, loginKb: 15, cssKb: 0, fonts: [] }
  assert.deepEqual(refusals(fine, limits), [])
  assert.match(refusals({ ...fine, entryKb: 10.1 }, limits)[0], /^entry/)
  assert.match(refusals({ ...fine, totalJsKb: 20.1 }, limits)[0], /^js/)
  assert.match(refusals({ ...fine, loginKb: 15.1 }, limits)[0], /^login/)
})

test('any font file in the bundle refuses', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  asset('index.js', 1)
  asset('face.woff2', 1)
  const m = measure(dist)
  assert.deepEqual(m.fonts, ['assets/face.woff2'])
  assert.match(refusals(m)[0], /web fonts/)
})
