import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Pull version from package.json at build time so the UI never lies about it.
// Match the parent monorepo's tagging: bump pkg.version when tagging Iceslab,
// the panel reflects it automatically on next build.
//
// `import.meta.dirname`, а не `__dirname`: последний существует только когда
// конфиг грузят как CommonJS, и vite 8 предупреждает об этом на каждом старте,
// потому что в следующей мажорной версии загрузчик по умолчанию сменится и
// строка просто перестанет работать.
const here = import.meta.dirname
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(here, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
