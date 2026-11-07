import type { ContourManifest } from '@/lib/contour'

const title = { ru: 'Сквады', en: 'Squads' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/squads', nav: 'squads', title, load: () => import('@/contours/squads/screens/SquadsPage') },
    { path: '/squads/new', title, load: () => import('@/contours/squads/screens/SquadFormPage') },
    { path: '/squads/:id', title, load: () => import('@/contours/squads/screens/SquadFormPage') },
  ],
}
