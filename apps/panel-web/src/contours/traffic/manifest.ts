import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [
    { path: '/routes', nav: 'routes', title: { ru: 'Маршруты', en: 'Routes' }, load: () => import('@/contours/traffic/screens/RoutesPage') },
    { path: '/outbounds', nav: 'outbounds', title: { ru: 'Выходы', en: 'Outbounds' }, load: () => import('@/contours/traffic/screens/OutboundsPage') },
    { path: '/geo', nav: 'geo', title: { ru: 'Гео-наборы', en: 'Geo sets' }, load: () => import('@/contours/traffic/screens/GeoSetsPage') },
  ],
}
