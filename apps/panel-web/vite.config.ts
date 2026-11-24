import optimizeLocales from '@react-aria/optimize-locales-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const here = import.meta.dirname
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf-8')) as {
  version: string
}

const network = ['nodes', 'hosts', 'cascades']
const traffic = ['traffic', 'subscription']
const admin = ['account', 'settings']

function screenGroup(name: string, contours: string[], wordsOnly = false) {
  return {
    name,
    priority: wordsOnly ? 1 : 0,
    test(id: string) {
      // The shell reads each manifest before any screen is opened.
      if (id.endsWith('/manifest.ts')) return false
      if (wordsOnly && !/\/(?:dict|\w+Dict)\.ts$/.test(id)) return false
      return contours.some((contour) => id.includes(`/contours/${contour}/`))
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // React Aria ships its strings for every language it knows; the panel speaks two.
    { ...optimizeLocales.vite({ locales: ['ru-RU', 'en-US'] }), enforce: 'pre' },
    react(),
  ],
  resolve: {
    alias: { '@': resolve(here, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Read by scripts/budget.mjs: which files a screen loads. The image leaves it out.
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: mode === 'production' ? {
          // Compress related lazy screens together. Keep their shared dependencies
          // independently loadable by the shell, login and profile editor.
          includeDependenciesRecursively: false,
          groups: [
            { name: 'legacy-api', test: /\/lib\/old\// },
            { name: 'query', test: /\/node_modules\/@tanstack\// },
            screenGroup('network-words', [...network, ...traffic], true),
            screenGroup('operator-words', ['squads', 'insights', 'overview', 'audit', ...admin], true),
            screenGroup('network', network),
            screenGroup('traffic-subscription', [...traffic, 'insights']),
            screenGroup('admin', admin),
            screenGroup('users', ['users']),
            screenGroup('squads', ['squads']),
          ],
        } : true,
      },
    },
  },
  server: {
    // Same origin in development too: the session is a SameSite=Strict cookie.
    proxy: {
      '/api': process.env.PANEL_API ?? 'http://127.0.0.1:2515',
      '/admin': process.env.PANEL_API ?? 'http://127.0.0.1:2515',
      '/health': process.env.PANEL_API ?? 'http://127.0.0.1:2515',
      // A regex: a bare /sub would swallow the /subscription screens.
      '^/sub/': process.env.PANEL_API ?? 'http://127.0.0.1:2515',
    },
  },
}))
