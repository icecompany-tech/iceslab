import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Ноды', en: 'Nodes' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/nodes', nav: 'nodes', title, load: () => import('@/contours/nodes/screens/NodesPage') },
    { path: '/nodes/new', title, load: () => import('@/contours/nodes/screens/NodeCreatePage') },
    { path: '/nodes/:id', title, load: () => import('@/contours/nodes/screens/NodeEditPage') },
  ],
}
