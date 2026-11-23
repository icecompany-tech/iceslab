import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [
    { path: '/routes', wide: true, nav: 'routes', title: { ru: 'Маршруты', en: 'Routes' }, load: () => import('@/contours/traffic/screens/RoutesPage') },
    { path: '/outbounds', wide: true, nav: 'outbounds', title: { ru: 'Выходы', en: 'Outbounds' }, load: () => import('@/contours/traffic/screens/OutboundsPage') },
    { path: '/geo', wide: true, nav: 'geo', title: { ru: 'Гео-наборы', en: 'Geo sets' }, load: () => import('@/contours/traffic/screens/GeoSetsPage') },
  ],
}
