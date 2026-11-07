import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [{ path: '/settings', nav: 'settings', title: { ru: 'Настройки', en: 'Settings' }, load: () => import('@/contours/settings/screens/SettingsPage') }],
}
