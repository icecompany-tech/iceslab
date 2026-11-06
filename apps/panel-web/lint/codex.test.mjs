// Codex rules a linter cannot see, because they are about the tree and not one file.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { screensWithoutStates, undefinedTokens, unknownLayers } from './codex.mjs'

const src = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
const files = walk(src).map((f) => relative(src, f).split(sep).join('/'))
const read = (f) => readFileSync(join(src, f), 'utf8')

test('every var(--x) in a stylesheet is a token: a typo paints nothing and says nothing', () => {
  const sheets = Object.fromEntries(files.filter((f) => f.endsWith('.css')).map((f) => [f, read(f)]))
  assert.deepEqual(undefinedTokens(sheets, sheets['ui/tokens.css']), [])
})

test('the check finds a token that does not exist, and passes what React Aria sets', () => {
  const tokens = ':root { --a: 1; }'
  assert.deepEqual(
    undefinedTokens({ 'x.css': 'b { c: var(--a); d: var(--trigger-width); e: var(--nope); }' }, tokens),
    ['x.css: --nope'],
  )
})

test('F8: a folder in src/ui is a layer named on the Paper page', () => {
  const folders = readdirSync(join(src, 'ui'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  assert.deepEqual(unknownLayers(folders), [])
  assert.deepEqual(unknownLayers(['Button', 'Banana']), ['Banana'])
})

test('F3: every screen tests loading, empty, failure and "not verified"', () => {
  const screens = files.filter((f) => /^contours\/[^/]+\/screens\/[^/]+\.tsx$/.test(f) && !f.endsWith('.test.tsx'))
  const tests = Object.fromEntries(
    screens.map((f) => {
      const t = f.replace(/\.tsx$/, '.test.tsx')
      return [f, existsSync(join(src, t)) ? read(t) : null]
    }),
  )
  assert.deepEqual(screensWithoutStates(tests), [])
})

test('the F3 check names what a screen test is missing', () => {
  const full = "it('загрузка') it('пусто') it('сбой') it('не проверено')"
  assert.deepEqual(screensWithoutStates({ 'a.tsx': full }), [])
  assert.deepEqual(screensWithoutStates({ 'a.tsx': null }), ['a.tsx: no test file'])
  assert.deepEqual(screensWithoutStates({ 'a.tsx': "it('загрузка') it('пусто')" }), ['a.tsx: сбой, не проверено'])
})
