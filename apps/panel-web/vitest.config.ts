import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(here, 'src') },
  },
  test: {
    globals: false,
    // No DOM by default: a file that needs one asks for it in its first line
    // (`// @vitest-environment jsdom`), so the cost is visible where it is paid.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
    setupFiles: ['src/test/setup.ts'],
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions', 'json'] : ['default'],
    outputFile: { json: 'vitest-report.json' },
  },
})
