export const sessions: [
  user: string,
  node: string,
  protocol: string,
  origin: string,
  since: string,
  traffic: string,
  activity: string,
][] = [
  ['vasya_2291', 'aeza-de-01', 'Основной, vless', '95.24.16.8 · RU', '2 ч назад', '1.4 ГБ', 'сейчас'],
  ['nikita.k', 'aeza-se-p-01', 'Резерв, hysteria2', '178.66.3.12 · RU', '40 мин назад', '312 МБ', 'сейчас'],
  ['anna_v', 'aeza-de-01', 'Основной, vless', '95.24.16.77 · RU', '5 ч назад', '2.1 ГБ', '1 мин назад'],
  ['anna_v', 'aeza-de-01', 'Основной, vless', '185.12.4.9 · DE', '10 мин назад', '84 МБ', 'сейчас'],
  ['petr_m', 'ruvds-kz-01', 'Основной, tuic', '46.39.8.2 · KZ', '3 ч назад', '640 МБ', 'снят 40 мин'],
  ['ядро не называет юзеров', 'aeza-nl-02', 'Обход, naive', '3 соединения', 'неизвестно', 'нет данных', 'сейчас'],
]

export const torrents: [user: string, last: string, node: string, core: string, attempts: string, outcome: string][] = [
  ['vasya_2291', 'сегодня, 14:02', 'aeza-de-01', 'xray', '184', 'отключён по порогу'],
  ['nikita.k', 'сегодня, 13:40', 'aeza-se-p-01', 'sing-box', '37', 'только записано'],
  ['office-3', 'сегодня, 11:12', 'aeza-de-01', 'xray', '12', 'только записано'],
  ['anna_v', 'вчера, 22:31', 'ruvds-kz-01', 'sing-box', '6', 'только записано'],
  ['petr_m', '3 ноября, 18:05', 'aeza-de-01', 'xray', '3', 'только записано'],
]

export const dns: [node: string, servers: string, addresses: string, cache: string, status: string][] = [
  ['aeza-de-01', '77.88.8.8, 1.1.1.1, 8.8.8.8', 'только IPv4', 'да', 'применено 2 мин назад'],
  ['aeza-nl-02', 'https://dns.google/dns-query', 'IPv4 и IPv6', 'нет', 'применено вчера'],
  ['aeza-se-p-01', 'как настроено у ядра', 'как у ядра', 'да', 'своих настроек нет'],
  ['ruvds-kz-01', '9.9.9.9, 1.1.1.1', 'только IPv4', 'да', 'нода не на связи, ждём'],
]

export const http: [
  route: string,
  total: string,
  ok: string,
  clientErrors: string,
  serverErrors: string,
  p50: string,
  p95: string,
][] = [
  ['GET /api/sub/:token', '96 120', '95 980', '140', '0', '12 мс', '38 мс'],
  ['POST /api/node/report', '61 200', '61 200', '0', '0', '8 мс', '22 мс'],
  ['GET /api/users', '9 840', '9 830', '10', '0', '24 мс', '84 мс'],
  ['POST /api/auth/login', '412', '380', '32', '0', '110 мс', '240 мс'],
  ['POST /api/nodes/:id/apply', '318', '277', '0', '41', '420 мс', '1.9 с'],
]

export const queues: [
  queue: string,
  description: string,
  waiting: string,
  running: string,
  delayed: string,
  failed: string,
  done: string,
  status: string,
][] = [
  ['Настройка нод', 'inbound-sync: применяет профили и хосты на нодах', '0', '1', '0', '0', '1 240', 'работает'],
  ['Юзеры на нодах', 'node-users: добавляет и снимает юзеров на нодах', '3', '2', '12', '4', '8 120', 'работает'],
  ['Гео-наборы', 'geo-sets: рассылает наборы по нодам', '0', '0', '0', '0', '16', 'работает'],
  ['Плановые задачи', 'cron-tasks: сроки подписок, сброс трафика, чистка', '0', '0', '6', '0', '288', 'на паузе'],
]

export const jobs: [id: string, action: string, attempts: string, when: string, reason: string][] = [
  ['84213', 'добавить vasya_2291 на aeza-de-01', '5 из 5', 'сегодня, 14:10', 'node timeout after 10s'],
  ['84207', 'снять petr_m с ruvds-kz-01', '5 из 5', 'сегодня, 13:52', 'connect ECONNREFUSED :2222'],
  ['84190', 'добавить anna_v на aeza-de-01', '5 из 5', 'сегодня, 13:10', 'node timeout after 10s'],
  ['84102', 'добавить nikita.k на aeza-nl-02', '5 из 5', 'вчера, 23:40', 'agent answered 500'],
]
