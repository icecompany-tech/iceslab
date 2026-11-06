import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { entryFiles, measure, refusals } from './budget.mjs'

let dist

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'budget-'))
  mkdirSync(join(dist, 'assets'))
})

afterEach(() => rmSync(dist, { recursive: true, force: true }))

const html = (body) => writeFileSync(join(dist, 'index.html'), body)

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

test('a lazy chunk counts for the total and not for the entry', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  // Random bytes do not compress, so the size in the assertion is the size written.
  writeFileSync(join(dist, 'assets', 'index.js'), randomBytes(10 * 1024))
  writeFileSync(join(dist, 'assets', 'lazy.js'), randomBytes(30 * 1024))
  const m = measure(dist)
  assert.ok(m.entryKb > 9 && m.entryKb < 12, `entry ${m.entryKb}`)
  assert.ok(m.totalJsKb > 39 && m.totalJsKb < 43, `total ${m.totalJsKb}`)
})

test('each budget refuses on its own, and at the limit it passes', () => {
  const limits = { entryKb: 10, totalJsKb: 20 }
  const fine = { entryKb: 10, totalJsKb: 20, cssKb: 0, fonts: [] }
  assert.deepEqual(refusals(fine, limits), [])
  assert.match(refusals({ ...fine, entryKb: 10.1 }, limits)[0], /^entry/)
  assert.match(refusals({ ...fine, totalJsKb: 20.1 }, limits)[0], /^js/)
})

test('any font file in the bundle refuses', () => {
  html('<script type="module" src="/assets/index.js"></script>')
  writeFileSync(join(dist, 'assets', 'index.js'), 'x')
  writeFileSync(join(dist, 'assets', 'face.woff2'), 'x')
  const m = measure(dist)
  assert.deepEqual(m.fonts, ['assets/face.woff2'])
  assert.match(refusals(m)[0], /web fonts/)
})
