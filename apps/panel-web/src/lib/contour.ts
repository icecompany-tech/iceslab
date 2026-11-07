// A contour says here which addresses it serves. The app finds every manifest by glob, so
// a new screen is a new folder and no shared file changes (codex: "Новый экран").
import type { ComponentType } from 'react'
import type { Locale } from '@/lib/i18n'

export interface ContourRoute {
  path: string
  /** A screen with no session: sign-in and the like. */
  public?: boolean
  /** The id of the menu item this address lights up, app/nav.ts. */
  nav?: string
  title?: Record<Locale, string>
  load: () => Promise<{ default: ComponentType }>
}

export interface ContourManifest {
  routes: readonly ContourRoute[]
}
