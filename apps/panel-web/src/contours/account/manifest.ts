import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Учётка', en: 'Account' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/account', title, load: () => import('@/contours/account/screens/AccountPage') },
    { path: '/account/tokens/new', title, load: () => import('@/contours/account/screens/TokenFormPage') },
  ],
}
