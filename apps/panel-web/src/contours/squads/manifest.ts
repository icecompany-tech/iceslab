import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Сквады', en: 'Squads' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/squads', wide: true, nav: 'squads', title, load: () => import('@/contours/squads/screens/SquadsPage') },
    { path: '/squads/new', wide: true, title, load: () => import('@/contours/squads/screens/SquadFormPage') },
    { path: '/squads/:id', wide: true, title, load: () => import('@/contours/squads/screens/SquadFormPage') },
  ],
}
