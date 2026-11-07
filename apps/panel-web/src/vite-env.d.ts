/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Stand only: the old panel on its second port, for screens not replaced yet. */
  readonly VITE_OLD_PANEL_URL?: string
  readonly VITE_GITHUB_URL?: string
  readonly VITE_TELEGRAM_URL?: string
  readonly VITE_DISCORD_URL?: string
  readonly VITE_DOCS_URL?: string
  readonly VITE_SUPPORT_URL?: string
}
