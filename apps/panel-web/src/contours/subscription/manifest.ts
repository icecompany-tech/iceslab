import type { ContourManifest } from '@/lib/contour'

const params = { ru: 'Параметры подписки', en: 'Subscription parameters' }
const delivery = { ru: 'Выдача', en: 'Delivery' }
const templates = { ru: 'Шаблоны', en: 'Templates' }

export const manifest: ContourManifest = {
  routes: [
    { path: '/subscription/params', nav: 'subscription-params', title: params, load: () => import('@/contours/subscription/screens/ParamsPage') },
    { path: '/subscription/delivery', nav: 'delivery', title: delivery, load: () => import('@/contours/subscription/screens/DeliveryPage') },
    { path: '/subscription/templates', nav: 'templates', title: templates, load: () => import('@/contours/subscription/screens/TemplatesPage') },
    { path: '/subscription/templates/new', nav: 'templates', title: templates, load: () => import('@/contours/subscription/screens/TemplateEditPage') },
    { path: '/subscription/templates/:id', nav: 'templates', title: templates, load: () => import('@/contours/subscription/screens/TemplateEditPage') },
  ],
}
