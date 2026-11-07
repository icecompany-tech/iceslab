// The frontend codex as lint: docs/arch/spec/02-code.md, "SOLID для фронта". Each block
// names the rule it holds. lint/rules.test.mjs proves every one of them fires.
import js from '@eslint/js'
import { existsSync, readdirSync } from 'node:fs'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { maxProps } from './lint/maxProps.js'

const here = import.meta.dirname

const parent = { regex: '^\\.\\./', message: 'Import through @/, not ../' }
const oldStack = {
  regex: '^(@mantine/|@tabler/|@fontsource|axios$)',
  message: 'Not in the new panel: own components, system fonts (F7), the client in lib/net',
}
const headless = {
  regex: '^(react-aria|react-stately|@react-aria/|@react-stately/|@internationalized/)',
  message: 'The headless library is reached through src/ui only',
}
const net = { regex: '^@/lib/net/client$', message: 'Only hooks/ and screens/ reach the network (rule S)' }
const contour = { regex: '^@/contours/', message: 'lib and ui do not know contours (F1)' }
const app = { regex: '^@/app(/|$)', message: 'Nothing imports the app (F1)' }
const ui = { regex: '^@/ui(/|$)', message: 'lib does not draw (F1)' }

const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns: [parent, oldStack, ...patterns] }],
})

// Rule F6: a colour or a size lives in tokens.css. Also in a template string.
const literal = (pattern, message) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.raw=${pattern}]`, message },
]
const noLiterals = [
  ...literal('/(^|[\\s(,])#[0-9a-fA-F]{3,8}\\b/', 'Colour from a token (F6)'),
  ...literal('/\\b(rgb|rgba|hsl|hsla)\\(/', 'Colour from a token (F6)'),
  ...literal('/\\b\\d+(\\.\\d+)?(px|rem)\\b/', 'Size from a token (F6)'),
  ...literal('/\\.(woff2?|ttf|otf)\\b/', 'System fonts only (F7)'),
]
const syntax = [
  ...noLiterals,
  { selector: "JSXAttribute[name.name='style']", message: 'Style from a CSS module and tokens (F6)' },
  { selector: 'TSAsExpression > TSUnknownKeyword', message: 'Parse the value at the edge, no `as unknown` (F2)' },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Randomness through crypto.getRandomValues, tests excepted (F10)' },
]
// Rule D: the clock comes through a provider or an argument.
const noClock = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Clock through a provider (rule D)' },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Clock through a provider (rule D)' },
]
const noGlobals = {
  'no-restricted-globals': [
    'error',
    { name: 'localStorage', message: 'Storage through a provider (rule D)' },
    { name: 'sessionStorage', message: 'Storage through a provider (rule D)' },
    { name: 'fetch', message: 'The client in lib/net (rule S)' },
    { name: 'confirm', message: 'A dangerous action asks with its cost on the spot (F5)' },
    { name: 'alert', message: 'A dangerous action asks with its cost on the spot (F5)' },
    { name: 'prompt', message: 'A dangerous action asks with its cost on the spot (F5)' },
  ],
}

function listContours(root) {
  const dir = `${root}/src/contours`
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []
}

export function buildConfig({ typed = true, contours = listContours(here) } = {}) {
  return defineConfig([
    globalIgnores(['dist']),
    {
      files: ['**/*.{ts,tsx}'],
      extends: [
        js.configs.recommended,
        tseslint.configs.recommended,
        reactHooks.configs.flat.recommended,
        reactRefresh.configs.vite,
      ],
      languageOptions: {
        globals: globals.browser,
        // The type-aware rule below needs the project. rules.test.mjs lints snippets of
        // files that do not exist, which the project service refuses, so it goes without.
        parserOptions: typed ? { projectService: true, tsconfigRootDir: here } : {},
      },
      plugins: { iceslab: { rules: { 'max-props': maxProps } } },
      rules: {
        ...restrict(headless),
        ...noGlobals,
        'no-restricted-syntax': ['error', ...syntax, ...noClock],
        'iceslab/max-props': 'error',
      },
    },
    // Build configs run in node and are nobody's layer.
    { files: ['*.config.ts'], rules: { 'no-restricted-imports': 'off' } },
    // Rule O: a union switched over names every member, a new one breaks the build.
    ...(typed
      ? [
          {
            files: ['src/**/*.{ts,tsx}'],
            rules: {
              '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: false }],
            },
          },
        ]
      : []),
    // The app is where details are plugged in: clock, storage, the locale of React Aria.
    {
      files: ['src/app/**/*.{ts,tsx}'],
      rules: {
        ...restrict(),
        'no-restricted-globals': 'off',
        'no-restricted-syntax': ['error', ...syntax],
      },
    },
    // F1: app -> contours -> ui, lib. Rule S: a component does not reach the network.
    {
      files: ['src/ui/**/*.{ts,tsx}'],
      rules: restrict(contour, app, net),
    },
    {
      files: ['src/lib/**/*.{ts,tsx}'],
      // A provider and its hook live together: the hook is the only door to the context.
      rules: { ...restrict(contour, app, ui, headless), 'react-refresh/only-export-components': 'off' },
    },
    {
      files: ['src/lib/net/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [parent, contour, app, ui, headless] }],
        'no-restricted-globals': 'off',
      },
    },
    // Copied as it stands from the frozen panel, tests with it; goes away with the Go API in S1.
    { files: ['src/lib/old/**/*.ts'], rules: { '@typescript-eslint/switch-exhaustiveness-check': 'off' } },
    // The one door to browser storage (rule D).
    { files: ['src/lib/storage.ts'], rules: { 'no-restricted-globals': 'off' } },
    // National colours are not the theme: the one named exception to F6.
    { files: ['src/ui/Flag/flags.ts'], rules: { 'no-restricted-syntax': 'off' } },
    ...contours.flatMap((c) => {
      const other = { regex: `^@/contours/(?!${c}/)`, message: 'Contours do not import each other (F1)' }
      return [
        { files: [`src/contours/${c}/**/*.{ts,tsx}`], rules: restrict(headless, app, other, net) },
        {
          files: [`src/contours/${c}/{hooks,screens}/**/*.{ts,tsx}`],
          rules: restrict(headless, app, other),
        },
      ]
    }),
    // F9: a test goes through the door, role and text, not classes and internals.
    {
      files: ['src/**/*.test.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[property.name=/^(querySelector|querySelectorAll|getElementById|getElementsByClassName|className|classList)$/]",
            message: 'Find it by role and text (F9)',
          },
          { selector: 'Identifier[name=/TestId$/]', message: 'Find it by role and text (F9)' },
        ],
        'no-restricted-globals': 'off',
        'iceslab/max-props': 'off',
      },
    },
  ])
}

export default buildConfig()
