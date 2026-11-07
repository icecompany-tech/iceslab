import type { Locale } from '@/lib/i18n'
import type { IconName } from '@/ui/Icon/Icon'

export interface NavItem {
  id: string
  icon: IconName
  title: Record<Locale, string>
  /** Where the new panel serves it, when a contour claims the id. */
  path: string
  /** A page outside the new app. `/admin/queues` until S2, 02-migration. */
  external?: string
}

export interface NavGroup {
  id: string
  title: Record<Locale, string>
  items: readonly NavItem[]
}

const t = (ru: string, en: string) => ({ ru, en })

export const MAIN_NAV: readonly NavItem[] = [
  { id: 'overview', icon: 'overview', title: t('Обзор', 'Overview'), path: '/' },
  { id: 'users', icon: 'users', title: t('Юзеры', 'Users'), path: '/users' },
  { id: 'squads', icon: 'squads', title: t('Сквады', 'Squads'), path: '/squads' },
  { id: 'profiles', icon: 'profiles', title: t('Профили', 'Profiles'), path: '/profiles' },
  { id: 'hosts', icon: 'hosts', title: t('Хосты', 'Hosts'), path: '/hosts' },
  { id: 'nodes', icon: 'nodes', title: t('Ноды', 'Nodes'), path: '/nodes' },
]

// Only what v0.4.0 has: pages that are new and have no server yet stay out of the menu
// (ARCH 2026-11-06, F-V1), and the frame's items come back with them.
export const GROUP_NAV: readonly NavGroup[] = [
  {
    id: 'subscription',
    title: t('Подписка', 'Subscription'),
    items: [
      { id: 'subscription-params', icon: 'settings', title: t('Параметры', 'Parameters'), path: '/subscription/params' },
      { id: 'delivery', icon: 'routes', title: t('Выдача', 'Delivery'), path: '/subscription/delivery' },
      { id: 'templates', icon: 'journal', title: t('Шаблоны', 'Templates'), path: '/subscription/templates' },
    ],
  },
  {
    id: 'traffic',
    title: t('Трафик', 'Traffic'),
    items: [
      { id: 'routes', icon: 'routes', title: t('Маршруты', 'Routes'), path: '/routes' },
      { id: 'outbounds', icon: 'outbounds', title: t('Выходы', 'Outbounds'), path: '/outbounds' },
      { id: 'geo', icon: 'geo', title: t('Гео-наборы', 'Geo sets'), path: '/geo' },
    ],
  },
  {
    id: 'observe',
    title: t('Наблюдение', 'Observation'),
    items: [
      { id: 'requests', icon: 'requests', title: t('Запросы подписки', 'Subscription requests'), path: '/requests' },
      { id: 'devices', icon: 'phone', title: t('Устройства', 'Devices'), path: '/devices' },
    ],
  },
  {
    id: 'system',
    title: t('Система', 'System'),
    items: [
      { id: 'audit', icon: 'journal', title: t('Журнал', 'Audit log'), path: '/audit' },
      { id: 'queues', icon: 'queues', title: t('Очереди', 'Queues'), path: '/admin/queues', external: '/admin/queues' },
      { id: 'settings', icon: 'settings', title: t('Настройки', 'Settings'), path: '/settings' },
    ],
  },
]
