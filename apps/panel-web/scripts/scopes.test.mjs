// The token form offers what the server grants (B3): the two lists are held against each other,
// so a resource added on the server shows up here as a red test, not as a section nobody can tick.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const here = import.meta.dirname
const hook = readFileSync(resolve(here, '../../panel-backend/src/modules/auth/scope.hook.ts'), 'utf8')
const form = readFileSync(resolve(here, '../src/contours/account/lib/tokenBody.ts'), 'utf8')

const server = [...(/SCOPEABLE_RESOURCES = \[([\s\S]*?)\] as const/.exec(hook)?.[1] ?? '').matchAll(/^\s*'([a-z-]+)',/gm)].map((m) => m[1])
const screen = [...(/RESOURCES = \[([^\]]*)\] as const/.exec(form)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])

test('both lists read at all', () => {
  assert.ok(server.length > 10, `server ${server.length}`)
  assert.ok(screen.length > 10, `screen ${screen.length}`)
})

test('the token form offers exactly what the server grants', () => {
  assert.deepEqual([...screen].sort(), [...server].sort())
})
