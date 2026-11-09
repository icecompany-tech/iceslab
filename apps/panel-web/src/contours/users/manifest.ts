import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [
    {
      path: '/users', wide: true,
      nav: 'users',
      title: { ru: 'Юзеры', en: 'Users' },
      load: () => import('@/contours/users/screens/UsersPage'),
    },
  ],
}
