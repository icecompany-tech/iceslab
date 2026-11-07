import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { matchPath } from 'react-router-dom'
import type { ContourManifest, ContourRoute } from '@/lib/contour'

const manifests = import.meta.glob<{ manifest: ContourManifest }>('/src/contours/*/manifest.ts', { eager: true })

export interface AppRoute extends ContourRoute {
  Screen: LazyExoticComponent<ComponentType>
}

export const ROUTES: readonly AppRoute[] = Object.values(manifests)
  .flatMap(({ manifest }) => manifest.routes)
  .map((route) => ({ ...route, Screen: lazy(route.load) }))

export const SERVED_NAV = new Set(ROUTES.flatMap((r) => (r.nav ? [r.nav] : [])))

export const routeAt = (pathname: string) => ROUTES.find((r) => matchPath(r.path, pathname))
