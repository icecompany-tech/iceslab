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

// Demo build (VITE_DEMO_MODE=true) is served from a sub-path inside an iframe
// on the marketing site, so assets must resolve under /panel-demo/. The normal
// build stays at root.
const isDemo = process.env.VITE_DEMO_MODE === 'true'

export default defineConfig({
  base: isDemo ? '/panel-demo/' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Real boolean literal so `if (DEMO_MODE)` folds away and the demo module +
    // fixtures are tree-shaken from the normal build.
    __DEMO_MODE__: isDemo,
  },
})
