import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [
    { path: '/requests', nav: 'requests', title: { ru: 'Запросы подписки', en: 'Subscription requests' }, load: () => import('@/contours/insights/screens/RequestsPage') },
    { path: '/devices', nav: 'devices', title: { ru: 'Устройства', en: 'Devices' }, load: () => import('@/contours/insights/screens/DevicesPage') },
  ],
}
