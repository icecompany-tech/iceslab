import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Каскады', en: 'Cascades' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/cascades', nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadesPage') },
    { path: '/cascades/new', nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadeFormPage') },
    { path: '/cascades/:id', nav: 'nodes', title, load: () => import('@/contours/cascades/screens/CascadeFormPage') },
  ],
}
