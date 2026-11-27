import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Хосты', en: 'Hosts' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/hosts', wide: true, nav: 'hosts', title, load: () => import('@/contours/hosts/screens/HostsPage') },
    { path: '/hosts/new', wide: true, title, load: () => import('@/contours/hosts/screens/HostFormPage') },
    { path: '/hosts/:id', wide: true, title, load: () => import('@/contours/hosts/screens/HostFormPage') },
  ],
}
