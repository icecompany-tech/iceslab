import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Профили', en: 'Profiles' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/profiles', wide: true, nav: 'profiles', title, load: () => import('@/contours/profiles/screens/ProfilesPage') },
    { path: '/profiles/new', wide: true, title, load: () => import('@/contours/profiles/screens/ProfileFormPage') },
    ...(import.meta.env.MODE === 'paper-review' ? [{ path: '/profiles/ru-reality', nav: 'profiles', title, load: () => import('@/contours/paper-review/profiles/ProfileReview') }] : []),
    { path: '/profiles/:id', wide: true, title, load: () => import('@/contours/profiles/screens/ProfileFormPage') },
  ],
}
