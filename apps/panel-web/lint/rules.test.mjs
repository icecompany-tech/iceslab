// A lint rule that does not fire looks exactly like clean code, so each one is shown a
// violation and the allowed neighbour of it. The snippets name files that do not exist:
// only the path decides which layer's rules apply.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ESLint } from 'eslint'
import stylelint from 'stylelint'
import { buildConfig } from '../eslint.config.js'
import stylelintConfig from '../stylelint.config.mjs'

const eslint = new ESLint({
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  overrideConfigFile: true,
  overrideConfig: buildConfig({ typed: false, contours: ['users', 'nodes'] }),
})

async function messages(file, code) {
  const [result] = await eslint.lintText(code, { filePath: file })
  return result.messages.filter((m) => m.ruleId !== 'react-refresh/only-export-components').map((m) => m.message)
}

const COMPONENT = 'src/ui/Foo/Foo.tsx'

const refused = [
  ['F1 a contour imports a contour', 'src/contours/users/lib/a.ts', "import { x } from '@/contours/nodes/lib/b'\nexport const y = x", /do not import each other/],
  ['F1 a contour imports the app', 'src/contours/users/lib/a.ts', "import { x } from '@/app/b'\nexport const y = x", /Nothing imports the app/],
  ['F1 ui imports a contour', COMPONENT, "import { x } from '@/contours/users/lib/b'\nexport const y = x", /do not know contours/],
  ['F1 lib imports ui', 'src/lib/a.ts', "import { x } from '@/ui/b'\nexport const y = x", /lib does not draw/],
  ['F1 relative parent import', 'src/lib/a.ts', "import { x } from '../b'\nexport const y = x", /through @\//],
  ['S a component reaches the network', 'src/contours/users/components/Row.tsx', "import { get } from '@/lib/net/client'\nexport const y = get", /reach the network/],
  ['S ui reaches the network', COMPONENT, "import { get } from '@/lib/net/client'\nexport const y = get", /reach the network/],
  ['S fetch by hand', 'src/lib/a.ts', "export const y = () => fetch('/api')", /client in lib\/net/],
  ['D storage in a component', COMPONENT, "export const y = () => localStorage.getItem('a')", /Storage through a provider/],
  ['D the clock in a component', COMPONENT, 'export const y = () => Date.now()', /Clock through a provider/],
  ['D new Date() in a contour', 'src/contours/users/lib/a.ts', 'export const y = () => new Date()', /Clock through a provider/],
  ['I eight props', COMPONENT, 'export interface FooProps { a: 1; b: 1; c: 1; d: 1; e: 1; f: 1; g: 1; h: 1 }', /8 props/],
  ['I eight props as a type', COMPONENT, 'export type FooProps = { a: 1; b: 1; c: 1; d: 1; e: 1; f: 1; g: 1; h: () => void }', /8 props/],
  ['F2 as unknown', 'src/lib/a.ts', 'export const y = (x: string) => x as unknown', /no `as unknown`/],
  ['F5 window.confirm', COMPONENT, "export const y = () => confirm('a')", /asks with its cost/],
  ['F6 hex in a string', COMPONENT, "export const y = '#FFF'", /Colour from a token/],
  ['F6 hex inside a value', COMPONENT, "export const y = '1 solid #A8E6FF'", /Colour from a token/],
  ['F6 rgb', COMPONENT, "export const y = 'rgb(0, 0, 0)'", /Colour from a token/],
  ['F6 px', COMPONENT, "export const y = '12px'", /Size from a token/],
  ['F6 px in a template', COMPONENT, 'export const y = (n: number) => `${n} 4px`', /Size from a token/],
  ['F6 inline style', COMPONENT, 'export const y = <div style={{ color: "var(--color-text)" }} />', /CSS module and tokens/],
  ['F7 a font file', COMPONENT, "export const y = 'face.woff2'", /System fonts only/],
  ['F7 fontsource', 'src/app/main.tsx', "import '@fontsource-variable/inter'", /Not in the new panel/],
  ['Mantine stays out', COMPONENT, "import { Box } from '@mantine/core'\nexport const y = Box", /Not in the new panel/],
  ['headless outside ui', 'src/contours/users/components/Row.tsx', "import { Button } from 'react-aria-components'\nexport const y = Button", /through src\/ui only/],
  ['F9 test by class', 'src/ui/Foo/Foo.test.tsx', "export const y = (e: HTMLElement) => e.querySelector('.a')", /by role and text/],
  ['F9 test by test id', 'src/ui/Foo/Foo.test.tsx', "export const y = (s: { getByTestId: (a: string) => void }) => s.getByTestId('a')", /by role and text/],
]

const allowed = [
  ['ui imports lib', COMPONENT, "import { x } from '@/lib/b'\nexport const y = x"],
  ['ui uses the headless library', COMPONENT, "import { Button } from 'react-aria-components'\nexport const y = Button"],
  ['a contour imports itself', 'src/contours/users/components/Row.tsx', "import { x } from '@/contours/users/lib/b'\nexport const y = x"],
  ['a contour imports ui', 'src/contours/users/screens/Page.tsx', "import { x } from '@/ui/b'\nexport const y = x"],
  ['a screen reaches the network', 'src/contours/users/screens/Page.tsx', "import { get } from '@/lib/net/client'\nexport const y = get"],
  ['a hook reaches the network', 'src/contours/users/hooks/useUsers.ts', "import { get } from '@/lib/net/client'\nexport const y = get"],
  ['the client itself uses fetch', 'src/lib/net/client.ts', "export const y = () => fetch('/api')"],
  ['the app holds the clock', 'src/app/clock.ts', 'export const y = () => Date.now()'],
  ['a date from a value', COMPONENT, 'export const y = (s: string) => new Date(s)'],
  ['seven props', COMPONENT, 'export interface FooProps { a: 1; b: 1; c: 1; d: 1; e: 1; f: 1; g: 1 }'],
  ['eight fields on a non-props type', COMPONENT, 'export interface Texts { a: 1; b: 1; c: 1; d: 1; e: 1; f: 1; g: 1; h: 1 }'],
  ['a hash that is not a colour', COMPONENT, "export const y = '/nodes/1#cores'"],
  ['a word with digits', COMPONENT, "export const y = 'top10px-free'"],
  ['a test by role', 'src/ui/Foo/Foo.test.tsx', "export const y = (s: { getByRole: (a: string) => void }) => s.getByRole('button')"],
]

describe('eslint', () => {
  for (const [name, file, code, expected] of refused) {
    test(`refuses: ${name}`, async () => {
      const found = await messages(file, code)
      assert.ok(found.some((m) => expected.test(m)), `got: ${JSON.stringify(found)}`)
    })
  }
  for (const [name, file, code] of allowed) {
    test(`allows: ${name}`, async () => {
      assert.deepEqual(await messages(file, code), [])
    })
  }
})

const css = async (code) => (await stylelint.lint({ code, config: stylelintConfig })).results[0].warnings.map((w) => w.rule)

describe('stylelint', () => {
  const cssRefused = [
    ['F6 hex', 'a { color: #fff; }', 'color-no-hex'],
    ['F6 a named colour', 'a { color: red; }', 'color-named'],
    ['F6 rgb', 'a { color: rgb(0 0 0); }', 'function-disallowed-list'],
    ['F6 px', 'a { width: 12px; }', 'unit-disallowed-list'],
    ['F6 a literal radius', 'a { border-radius: 50%; }', 'declaration-property-value-allowed-list'],
    ['F7 a font-face', '@font-face { font-family: x; }', 'at-rule-disallowed-list'],
    ['F7 a face by name', 'a { font-family: Inter; }', 'declaration-property-value-allowed-list'],
    ['F7 the font shorthand', 'a { font: 12px x; }', 'property-disallowed-list'],
  ]
  for (const [name, code, rule] of cssRefused) {
    test(`refuses: ${name}`, async () => assert.ok((await css(code)).includes(rule)))
  }
  test('allows tokens', async () => {
    const ok = 'a { color: var(--color-text); width: calc(var(--spacing-2) * 2); font-family: var(--font-sans); border-radius: var(--radius-md); }'
    assert.deepEqual(await css(ok), [])
  })
})
