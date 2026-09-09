import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Контуры src/contours/<имя>. Каждый получает свой блок правил: чужой контур
// импортировать нельзя. Список правится здесь и только здесь.
const contours = [
  'users', 'nodes', 'hosts', 'profiles', 'cascades', 'squads',
  'traffic', 'subscription', 'dashboard', 'settings', 'login',
]

const noParent = { regex: '^\\.\\./', message: 'Импорт через @/, не через ../' }

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
    rules: { 'no-restricted-imports': ['error', { patterns: [noParent] }] },
  },
  ...contours.map((c) => ({
    files: [`src/contours/${c}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        noParent,
        { regex: `^@/contours/(?!${c}/)`, message: 'Контуры не импортируют друг друга' },
      ] }],
    },
  })),
  {
    files: ['src/lib/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        noParent,
        { regex: '^@/contours/', message: 'lib и ui не знают о контурах' },
      ] }],
    },
  },
])
