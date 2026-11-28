import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Каскады', en: 'Cascades' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/cascades', wide: true, nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadesPage') },
    { path: '/cascades/new', wide: true, nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadeFormPage') },
    { path: '/cascades/:id', wide: true, nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadeFormPage') },
  ],
}
