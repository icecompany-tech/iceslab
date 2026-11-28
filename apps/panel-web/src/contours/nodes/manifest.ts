import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Ноды', en: 'Nodes' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/nodes', wide: true, nav: 'nodes', title, load: () => import('@/contours/nodes/screens/NodesPage') },
    { path: '/nodes/new', wide: true, title, load: () => import('@/contours/nodes/screens/NodeCreatePage') },
    { path: '/nodes/:id', wide: true, title, load: () => import('@/contours/nodes/screens/NodeEditPage') },
  ],
}
