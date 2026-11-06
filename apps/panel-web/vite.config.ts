import optimizeLocales from '@react-aria/optimize-locales-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const here = import.meta.dirname
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
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
  build: { manifest: true },
})
