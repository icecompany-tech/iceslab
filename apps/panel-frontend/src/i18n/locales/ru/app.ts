export const app = {
  sidebar: {
    home: 'Главная',
    users: 'Пользователи',
    profiles: 'Профили',
    squads: 'Сквады',
    hosts: 'Хосты',
    nodes: 'Ноды',
    cascades: 'Каскады',
    queues: 'Очереди',
    queuesDesc: 'BullMQ обзор',
    settings: 'Настройки',
    logout: 'Выйти',
    signedInAs: 'Под аккаунтом',
    workspace: 'Workspace',
    subscriptionGroup: 'Подписка',
    subscriptionMetadata: 'Метаданные',
    // Два имени вместо одного: «Маршруты» решают, куда пойдёт трафик после
    // входной ноды, «Выдача» решает, в каком ВИДЕ отдать конфиг. Пока оба
    // назывались маршрутизацией, любой разговор о маршрутах приводил не туда.
    subscriptionRoutes: 'Маршруты',
    subscriptionDelivery: 'Выдача',
    subscriptionTemplate: 'Шаблон',
    subscribePage: 'Страница подписки',
    infraBilling: 'Инфра-биллинг',
    trafficGroup: 'Трафик',
    policies: 'Политики',
    torrentBlocker: 'Torrent Blocker',
    ruleSets: 'Наборы правил',
    egress: 'Точки выхода',
    dns: 'DNS',
    toolsGroup: 'Инструменты',
    hwidInspector: 'Инспектор HWID',
    srhInspector: 'Инспектор SRH',
    torrentBlockerReports: 'Отчёты Torrent Blocker',
    sessionExplorer: 'Обозреватель сессий',
    httpStats: 'Статистика HTTP',
    // Пункт нарисован, но экрана за ним ещё нет. Подсказка на наведении, чтобы
    // клик в пустоту не выглядел поломкой.
    notWired: 'Экран ещё не готов',
    systemGroup: 'Система',
    insights: 'Аналитика',
    updateAvailable: 'Доступно обновление: {{version}}',
  },

  topbar: {
    // Латиницей в обеих локалях: это кнопка-марка, а не подпись в интерфейсе,
    // и «ПОДДЕРЖАТЬ» в моноширинном капсе ломает ритм правой части топбара.
    support: 'Support',
  },
} as const;
