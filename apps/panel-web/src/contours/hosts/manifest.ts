import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Хосты', en: 'Hosts' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/hosts', nav: 'hosts', title, load: () => import('@/contours/hosts/screens/HostsPage') },
    { path: '/hosts/new', title, load: () => import('@/contours/hosts/screens/HostFormPage') },
    { path: '/hosts/:id', title, load: () => import('@/contours/hosts/screens/HostFormPage') },
  ],
}
