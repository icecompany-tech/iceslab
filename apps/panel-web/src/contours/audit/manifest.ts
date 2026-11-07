import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes: [{ path: '/audit', nav: 'audit', title: { ru: 'Журнал', en: 'Audit log' }, load: () => import('@/contours/audit/screens/AuditPage') }],
}
