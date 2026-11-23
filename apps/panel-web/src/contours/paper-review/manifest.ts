import type { ContourManifest } from '@/lib/contour'

export const manifest: ContourManifest = {
  routes:
    import.meta.env.MODE === 'paper-review'
      ? [
          {
            path: '/subscription/page',
            nav: 'page-design',
            wide: false,
            title: { ru: 'Страница', en: 'Page designer' },
            load: () => import('./PageDesigner'),
          },
          {
            path: '/rule-sets',
            nav: 'rule-sets',
            wide: true,
            title: { ru: 'Наборы правил', en: 'Rule sets' },
            load: () => import('./RuleSets'),
          },
          { path: '/dns', nav: 'dns', wide: true, title: { ru: 'DNS', en: 'DNS' }, load: () => import('./Dns') },
          {
            path: '/torrents',
            nav: 'torrents',
            wide: true,
            title: { ru: 'Торренты', en: 'Torrents' },
            load: () => import('./Torrents'),
          },
          {
            path: '/sessions',
            nav: 'sessions',
            wide: true,
            title: { ru: 'Сессии', en: 'Sessions' },
            load: () => import('./Sessions'),
          },
          {
            path: '/http-stats',
            nav: 'http-stats',
            wide: true,
            title: { ru: 'Статистика HTTP', en: 'HTTP statistics' },
            load: () => import('./HttpStats'),
          },
          {
            path: '/admin/queues',
            nav: 'queues',
            wide: true,
            title: { ru: 'Очереди', en: 'Queues' },
            load: () => import('./Queues'),
          },
        ]
      : [],
}
