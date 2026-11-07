import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [{ path: '/login', public: true, load: () => import('@/contours/login/screens/LoginPage') }],
}
