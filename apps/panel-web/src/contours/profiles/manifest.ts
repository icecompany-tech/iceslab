import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Профили', en: 'Profiles' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/profiles', nav: 'profiles', title, load: () => import('@/contours/profiles/screens/ProfilesPage') },
    { path: '/profiles/new', title, load: () => import('@/contours/profiles/screens/ProfileFormPage') },
    { path: '/profiles/:id', title, load: () => import('@/contours/profiles/screens/ProfileFormPage') },
  ],
}
