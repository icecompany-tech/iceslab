import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [
    {
      path: '/', wide: true,
      nav: 'overview',
      title: { ru: 'Обзор', en: 'Overview' },
      load: () => import('@/contours/overview/screens/OverviewPage'),
    },
  ],
}
