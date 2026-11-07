const ruPlural = (n: number, one: string, few: string, many: string) => {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return many
  if (ones === 1) return one
  return ones >= 2 && ones <= 4 ? few : many
}

const ru = {
  loading: 'Считаем',
  failedTitle: 'Данные не загрузились',
  retry: 'Повторить',
  periodLabel: 'Период',
  days: (n: number) => `${n} дн`,
  requestsTitle: 'Запросы подписки',
  requestsHint: 'Кто тянет подписку, каким клиентом и когда. Считается по запросу из истории обращений.',
  statRequests: 'Запросов',
  statUsers: 'Разных юзеров',
  statPerDay: 'В день на юзера',
  statUnknown: 'Неизвестных клиентов',
  unknownHint: 'Клиенты, которых панель не узнала по User-Agent.',
  byClient: 'По клиентам',
  byHour: 'По часам, UTC',
  hourTitle: (hour: number, value: number) => `${String(hour).padStart(2, '0')}:00 UTC, ${value}`,
  noRequests: 'За этот период запросов подписки не было',
  noRequestsBody: 'Клиенты ещё не обращались к адресу подписки.',
  devicesTitle: 'Устройства',
  devicesHint: 'Физические устройства, тянувшие подписку. Снимок на сейчас: период к нему не относится.',
  statTracked: 'Устройств учтено',
  statWithDevices: 'Юзеров с устройствами',
  statAvg: 'В среднем на юзера',
  statAtLimit: 'На личном лимите и выше',
  perUser: 'Устройств на юзера',
  bucket: (bucket: string) => (bucket === '1' ? '1 устройство' : /^[2-4]$/.test(bucket) ? `${bucket} устройства` : `${bucket} устройств`),
  usersCount: (n: number) => `${n} ${ruPlural(n, 'юзер', 'юзера', 'юзеров')}`,
  noDevices: 'Устройства пока не учтены',
  noDevicesBody: 'Панель считает только клиентов, которые присылают идентификатор устройства.',
  atLimit: (n: number) => (n === 1 ? '1 юзер упёрся в свой лимит устройств. Следующее новое устройство ему откажут, пока не освободит одно.' : `${n} ${ruPlural(n, 'юзер', 'юзера', 'юзеров')} упёрлись в свой лимит устройств. Следующее новое устройство им откажут, пока не освободят одно.`),
  atLimitNote: 'Показать поимённо панель не может: в списке юзеров нет фильтра по числу устройств, а устройства читаются по одному аккаунту.',
  limitNote: 'Счёт только по личному лимиту юзера. Лимит сквада сюда не входит, поэтому упёршихся в него это число не показывает.',
  howTitle: 'Как считаются',
  how: (days: number) => `Устройство учитывается, когда клиент присылает заголовок x-hwid, и забывается через ${days} дней тишины. Клиенты, которые его не шлют, здесь не видны. Сбросить устройство можно в окне юзера.`,
  openUsers: 'К юзерам',
}

const enPlural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const en: typeof ru = {
  loading: 'Counting',
  failedTitle: 'The data did not load',
  retry: 'Retry',
  periodLabel: 'Period',
  days: (n: number) => `${n} d`,
  requestsTitle: 'Subscription requests',
  requestsHint: 'Who fetches the subscription, with which client and when. Counted on request from the history.',
  statRequests: 'Requests',
  statUsers: 'Distinct users',
  statPerDay: 'Per user per day',
  statUnknown: 'Unknown clients',
  unknownHint: 'Clients the panel did not recognise by User-Agent.',
  byClient: 'By client',
  byHour: 'By hour, UTC',
  hourTitle: (hour: number, value: number) => `${String(hour).padStart(2, '0')}:00 UTC, ${value}`,
  noRequests: 'No subscription requests in this period',
  noRequestsBody: 'Clients have not called the subscription address yet.',
  devicesTitle: 'Devices',
  devicesHint: 'Physical devices that fetched the subscription. A snapshot of now: the period does not apply.',
  statTracked: 'Devices counted',
  statWithDevices: 'Users with devices',
  statAvg: 'Average per user',
  statAtLimit: 'At the personal limit or above',
  perUser: 'Devices per user',
  bucket: (bucket: string) => (bucket === '1' ? '1 device' : `${bucket} devices`),
  usersCount: (n: number) => `${n} ${enPlural(n, 'user', 'users')}`,
  noDevices: 'No devices counted yet',
  noDevicesBody: 'The panel counts only clients that send a device identifier.',
  atLimit: (n: number) => `${n} ${enPlural(n, 'user has', 'users have')} hit the device limit. The next new device is refused until one is freed.`,
  atLimitNote: 'The panel cannot name them: the user list has no device-count filter, and devices are read one account at a time.',
  limitNote: 'Counted by the user\'s personal limit only. A squad limit is not in it, so users stuck on one are not in this number.',
  howTitle: 'How they are counted',
  how: (days: number) => `A device is counted when the client sends the x-hwid header, and forgotten after ${days} silent days. Clients that do not send it are not seen here. A device is reset in the user window.`,
  openUsers: 'To users',
}

export const DICT = { ru, en }
