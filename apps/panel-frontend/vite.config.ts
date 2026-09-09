import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Pull version from package.json at build time so the UI never lies about it.
// Match the parent monorepo's tagging: bump pkg.version when tagging Iceslab,
// the panel reflects it automatically on next build.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
