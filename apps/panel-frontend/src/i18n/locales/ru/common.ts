export const common = {
  common: {
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    edit: 'Редактировать',
    create: 'Создать',
    refresh: 'Обновить',
    confirm: 'Подтвердить',
    close: 'Закрыть',
    back: 'Назад',
    next: 'Далее',
    loading: 'Загрузка…',
    yes: 'Да',
    no: 'Нет',
    online: 'онлайн',
    offline: 'оффлайн',
    enabled: 'включён',
    disabled: 'отключён',
    add: 'Добавить',
    search: 'Поиск',
    copy: 'Копировать',
    copied: 'Скопировано',
    copyFailed: 'Не скопировалось',
    none: '-',
    all: 'Все',
    nothingFound: 'Ничего не найдено',
    saved: 'Сохранено',
    deleted: 'Удалено',
    created: 'Создано',
    updated: 'Обновлено',
    saveError: 'Не получилось сохранить',
    createError: 'Не получилось создать',
    deleteError: 'Не получилось удалить',
    actions: 'Действия',
  },

  validation: {
    nameRequired: 'Имя обязательно',
    nameLatinOnly: 'Только латиница, цифры, точка, _ и -',
    addressHostOnly: 'Только IP или DNS, без http:// и без порта',
    nameNoCyrillic: 'Только латиница, цифры, точка, _ и -. Без пробелов и кириллицы.',
    nameMin3: 'Минимум 3 символа',
    usernameMin3: 'Имя пользователя минимум 3 символа',
    passwordMin8: 'Пароль минимум 8 символов',
    usernameLatinOnly: 'Только буквы, цифры, _ и -',
    squadNameAllowed: 'Только буквы, цифры, пробел, _ и -',
    addressRequired: 'Адрес обязателен',
    portRequired: 'Порт обязателен',
    portRange: 'Порт от 1 до 65535',
    emailInvalid: 'Некорректный email',
    required: 'Обязательно',
    xray: {
      networkInvalid:
        'xray-core отвергнет config: REALITY поддерживает только raw / xhttp / grpc, не «{{network}}».',
      visionRequiresRaw:
        'Vision flow несовместим с {{network}}. Поставь Flow = «(none)» или Network = «raw».',
      trojanIgnoresFlow:
        'Trojan не использует flow, поле будет проигнорировано на клиенте.',
      rawWithoutVisionSlow:
        'Без Vision flow на raw transport теряется ~30% throughput из-за TLS-in-TLS. Рекомендуем добавить Vision если subprotocol = vless.',
    },
  },

  modal: {
    userNewTitle: 'Новый пользователь',
    userNewSubtitle: 'Subscription-токен и креды сгенерируются при сохранении',
    userEditSubtitle: 'Редактирование пользователя',
    nodeNewTitle: 'Новая нода',
    nodeNewSubtitle: 'Зарегистрировать VPS · мастер из 2 шагов',
    profileNewTitle: 'Новый профиль',
    profileNewSubtitle: 'Inbound-шаблон · привяжи к нодам после сохранения',
    profileEditSubtitle: 'Редактирование шаблона · применится при следующем деплое',
    squadNewTitle: 'Новый сквад',
    squadNewSubtitle: 'Срез доступа · группа пользователей + профилей',
    squadEditSubtitle: 'Редактирование состава',
    shortcutCreate: '⏎ Создать · Esc Отмена',
    shortcutSave: '⏎ Сохранить · Esc Отмена',
    shortcutTabNext: 'Tab следующее поле · Esc Отмена',
    shortcutCreateBack: '⏎ Создать · ← Назад править параметры',
    shortcutBuiltin: 'Системный · только чтение',
    stepNext: 'Дальше: выбрать профили →',
    createWithBindings_one: 'Создать ноду + {{count}} привязка',
    createWithBindings_few: 'Создать ноду + {{count}} привязки',
    createWithBindings_many: 'Создать ноду + {{count}} привязок',
    createWithBindings_other: 'Создать ноду + {{count}} привязки',
  },
  language: {
    label: 'Язык',
    russian: 'Русский',
    english: 'English',
  },

  // Факты, которые страница дописывает к строке в топбаре:
  // «/ ПОЛЬЗОВАТЕЛИ · 36 АККАУНТОВ · 21 АКТИВНЫХ».
  /**
   * Пара (протокол, движок). Диспетчер на ноде матчит именно её, поэтому
   * «hy2» в списке это половина ответа: Hysteria 2 обслуживают три разные
   * вещи с разным конфигом, разной статистикой и разной способностью нести
   * ногу каскада.
   */
  engine: {
    xray: 'ядро xray',
    singbox: 'движок sing-box',
    own: 'свой демон',
    pair: '{{protocol}} · {{engine}}',
    coresUnknown: 'ядра не сообщены',
    // Нода без ядер (intendedEngines пуст, метка none): стоит один агент.
    noCores: 'без ядер',
    plusSingbox: '{{pair}} + движок sing-box',
    coresNone: 'ни одного ядра',
    legNo: 'ногой каскада быть не может',
    legWhy:
      'Ногу цепочки строит xray, а среди ядер, которые сообщила эта нода, его нет. Такая нода годится выходом, но не звеном в середине.',
    cellUnrealised: '{{name}} · такой ноги нет, сохранить не даст',
    caveat: {
      noSalamander: 'без обфускации',
      noSalamanderWhy:
        'Обфускация Salamander есть только у собственного демона Hysteria 2, у ядра xray её нет вовсе. В РФ через DPI пробивает именно она, так что эта пара не замена, а другой продукт.',
    },
  },
  // Ядро профиля на ноде до сохранения (nodeCoreFit): окно «Развернуть» и
  // форма хоста. Та же граница, что у гейта BACK: нет ядра и плохая версия
  // закрывают галку, дрейф только говорит.
  nodeCore: {
    silent: 'нода не сообщила ядра',
    missing: 'на ноде нет ядра {{core}}',
    missingWhy: 'На этой ноде нет ядра {{core}}: поставить на странице ноды, секция «Ядра».',
    installLink: 'Как поставить',
    updateLink: 'Как обновить',
    blockedShort: 'хост сюда не встанет',
    // Отказ 409 гейта BACK (dd7a8cd): экран до него не доводит, это для
    // старого экрана и отчёта, который сменился под ним.
    gateMissing: 'Сервер отказал: на {{node}} нет ядра {{core}}. Поставить на машине по ssh:',
    gateRefused: 'Сервер отказал: {{core}} {{version}} на {{node}} отклонена панелью.',
    // 409 AWG_PROTOCOL_MISMATCH (227054e): профиль 3.1 на ноде с модулем 1.x.
    gateAwg: 'Нода {{node}} несёт модуль {{nodeGen}}, профиль требует {{profileGen}}.',
    gateAwgHow: 'Модуль 3.1 ставится повторным bootstrap AmneziaWG на ноде; он несёт и профили 1.x.',
    gateAfterInstall: 'Панель ничего не выполняет на машине. После установки нода сама сообщит о ядре, и сохранение пройдёт.',
    unpinnedInstall: {
      'no-arch': 'Версия не закреплена: нода не сообщила архитектуру, а файл и его контрольная сумма свои под каждую. Скрипт поставит свою версию по умолчанию.',
      'no-asset': 'Версия не закреплена: у релиза нет сборки под архитектуру ноды ({{arch}}). Скрипт поставит свою версию по умолчанию.',
      unpinned: 'Версия не закреплена: закреплять нечего (релиза в манифесте нет). Скрипт поставит свою версию по умолчанию.',
    },
    refused: '{{core}} {{version}}: версия отклонена панелью',
    refusedWhy: '{{core}} {{version}} отклонена панелью, хост на эту ноду не встанет. Причина из манифеста: {{reason}}',
    driftPin: '{{core}} {{version}}: версия не пин ({{target}})',
    driftChosen: '{{core}} {{version}}: не та, что выбрана для ноды ({{target}})',
    onPin: '{{core}} {{version}}, как в пине',
    onChosen: '{{core}} {{version}}, как выбрано для ноды',
    unpinned: '{{core}} {{version}}, у этого ядра пина нет',
    noVersion: '{{core}} стоит, версию нода не сообщила',
    part: {
      module: 'модуль',
      tools: 'tools',
    },
  },
  pageMeta: {
    /** The breadcrumb when the page's own list failed to load: a count would
     *  read as a real number and outlive the error card below it. */
    noData: 'данных нет',
    users_one: '{{count}} аккаунт',
    users_few: '{{count}} аккаунта',
    users_many: '{{count}} аккаунтов',
    users_other: '{{count}} аккаунта',
    usersActive: '{{count}} действующих',
    usersLimited: '{{count}} ограничено',
    hosts_one: '{{count}} хост',
    hosts_few: '{{count}} хоста',
    hosts_many: '{{count}} хостов',
    hosts_other: '{{count}} хоста',
    hostsEnabled: '{{count}} включено',
    hostCountries_one: '{{count}} страна',
    hostCountries_few: '{{count}} страны',
    hostCountries_many: '{{count}} стран',
    hostCountries_other: '{{count}} страны',
    routePolicies_one: '{{count}} политика',
    routePolicies_few: '{{count}} политики',
    routePolicies_many: '{{count}} политик',
    routePolicies_other: '{{count}} политики',
    squads_one: '{{count}} сквад',
    squads_few: '{{count}} сквада',
    squads_many: '{{count}} сквадов',
    squads_other: '{{count}} сквада',
    squadMembers_one: '{{count}} участник',
    squadMembers_few: '{{count}} участника',
    squadMembers_many: '{{count}} участников',
    squadMembers_other: '{{count}} участника',
    profiles_one: '{{count}} шаблон',
    profiles_few: '{{count}} шаблона',
    profiles_many: '{{count}} шаблонов',
    profiles_other: '{{count}} шаблона',
    profileProtocols_one: '{{count}} протокол в работе',
    profileProtocols_few: '{{count}} протокола в работе',
    profileProtocols_many: '{{count}} протоколов в работе',
    profileProtocols_other: '{{count}} протокола в работе',
    overviewLive: 'вживую',
    overviewRefresh: 'обновление {{n}}с',
    vps_one: '{{count}} VPS',
    vps_few: '{{count}} VPS',
    vps_many: '{{count}} VPS',
    vps_other: '{{count}} VPS',
    nodeCountries_one: '{{count}} страна',
    nodeCountries_few: '{{count}} страны',
    nodeCountries_many: '{{count}} стран',
    nodeCountries_other: '{{count}} страны',
    cascades_one: '{{count}} каскад',
    cascades_few: '{{count}} каскада',
    cascades_many: '{{count}} каскадов',
    cascades_other: '{{count}} каскада',
    cascadesEnabled: '{{count}} включено',
  },

  breadcrumb: {
    // Только имя страницы: пометка live и период обновления приходят фактами
    // со страницы, поэтому число не может разойтись с запросом, который его задаёт.
    dashboard: '/ ГЛАВНАЯ',
    users: '/ ПОЛЬЗОВАТЕЛИ',
    profiles: '/ ПРОФИЛИ',
    squads: '/ СКВАДЫ',
    nodes: '/ НОДЫ',
    hosts: '/ ХОСТЫ',
    subscriptionMetadata: '/ ПОДПИСКА · МЕТАДАННЫЕ',
    // Вторая вкладка тех же настроек. Без своей строки она унаследовала бы
    // крошку раздела и называлась бы «Метаданные», которых на ней нет.
    subscriptionDeliverySetup: '/ ПОДПИСКА · ФОРМАТ И АДРЕС',
    subscriptionRoutes: '/ ПОДПИСКА · МАРШРУТЫ',
    geoSets: '/ ТРАФИК · ГЕО-НАБОРЫ',
    subscriptionDelivery: '/ ПОДПИСКА · ВЫДАЧА',
    subscriptionTemplates: '/ ПОДПИСКА · ШАБЛОНЫ',
    insights: '/ СИСТЕМА · АНАЛИТИКА',
    settings: '/ НАСТРОЙКИ',
  },

  // ───── Iceslab redesign - new chrome keys (cycle #11+) ─────
  pageHero: {
    usersEyebrow_one: '{{count}} аккаунт · {{online}} онлайн{{limited}}',
    usersEyebrow_few: '{{count}} аккаунта · {{online}} онлайн{{limited}}',
    usersEyebrow_many: '{{count}} аккаунтов · {{online}} онлайн{{limited}}',
    usersEyebrow_other: '{{count}} аккаунта · {{online}} онлайн{{limited}}',
    usersEyebrowLimited: ' · {{count}} ограничено',
    usersTitle: 'Пользователи.',
    usersSubtitle:
      'Каждому пользователю выдаётся одна ссылка-подписка. Отключить, ограничить или отозвать, не затрагивая протокольный слой.',
    profilesEyebrow: 'Шаблоны inbound-ов · 7 протоколов поддерживается',
    profilesTitle: 'Профили.',
    profilesSubtitle:
      'Профиль задаёт один логический inbound: протокол, обфускацию, форму DPI. Привяжи к N нодам, пользователь подхватит через подписку.',
    inboundsEyebrow: 'Поднятые endpoint\'ы · {{count}} {{label}}',
    inboundsLabelOne: 'inbound',
    inboundsLabelMany: 'inbound\'ов',
    inboundsTitle: 'Inbound\'ы.',
    inboundsSubtitle:
      'Один inbound - это один протокол-листенер на одной ноде. Подключай тут; пользователи подхватят через сквад и подписку.',
    nodesEyebrow: 'Флот · {{vps}} VPS · {{countries}} стран',
    nodesTitle: 'Ноды.',
    nodesSubtitle:
      'Одна нода держит одно ядро протокола. Панель пушит конфиг по mTLS, агент применяет и отчитывается обратно.',
    squadsEyebrow: 'Группа ACL · {{count}} {{label}}',
    squadsLabelOne: 'сквад',
    squadsLabelMany: 'сквадов',
    settingsEyebrow: 'Конфиг панели',
    dashboardEyebrow: 'Live · авто-обновление 10с · {{time}}',
    dashboardHeadlineQuiet: 'Тихий день на линии.',
    dashboardHeadlineBusy: 'Загруженный флот сегодня.',
    dashboardHeadlineSteady: 'Стабильный трафик.',
    dashboardSubtitle:
      '{{nodes}} нод онлайн, {{users}} действующих аккаунтов. Агрегированный трафик и живая телеметрия хоста ниже - обновляется каждые десять секунд.',
    dashboardFooterNeverOnline:
      '{{count}} пользователь ни разу не был онлайн · Проверь provisioning',
    dashboardFooterNeverOnlinePlural:
      '{{count}} пользователей ни разу не были онлайн · Проверь provisioning',
    dashboardFooterAllProvisioned: 'Все пользователи подняты',
    dashboardFooterNoUsers: 'Пользователей пока нет',
    hostSystemSubtitle: 'хост-сервер',
    uptimeLabel: 'Uptime',
    sampledLabel: 'Sampled',
  },
  cascades: {
    title: 'Каскады',
    add: 'Новый каскад',
    empty: 'Каскадов пока нет.',
    entry: 'вход',
    transit: 'транзит',
    exit: 'выход',
    bar: {
      chains: 'КАСКАДОВ',
      enabled: 'ВКЛЮЧЕНО',
      today: 'СЕГОДНЯ',
      squads: 'СКВАДОВ',
    },
    col: {
      cascade: 'Каскад',
      // Не «режим»: его больше нет. Колонка говорит, сколько входов и сколько
      // выходов, и это и есть форма каскада.
      shape: 'Форма',
      path: 'Путь',
      reaches: 'Доступен',
      today: 'Сегодня',
      lastPush: 'Последний пуш',
    },
    role: {
      entry: 'вход',
      transit: 'транзит',
      exit: 'выход',
    },
    // Фишки ядер на карточке: остальные ядра ноды, которые каскад не трогает.
    coresAlso: 'ещё на ноде: {{list}}',
    // Нога внутри туннеля AmneziaWG (фаза 8).
    legInAwg: '{{cell}} в AWG',
    layoutRows: 'Строки',
    enabled: 'Включён',
    disabled: 'Выключен',
    off: 'off',
    enable: 'Включить',
    oneWayHint: 'Выход один, поэтому все клиенты идут одним путём',
    fanHint: 'Один вход, направлений {{n}}. Клиент выбирает одно, выбирая сервер',
    offHint: 'Пока выключен, на ноды ничего не уходит. Ноды продолжают отдавать свои хосты.',
    offShort: 'пока выключен, ничего не уходит',
    entryPolicy: 'политика входа «{{name}}»',
    // Направление выбирает клиент, пробовать нечего.
    clientPicks: 'выбирает клиент',
    directionTag: 'направление {{tag}}',
    directionUnnamed: 'без страны',
    // Законное состояние в модели v4: тег выдан, ноды за ним пока нет, клиентам
    // такое направление не отдаётся.
    directionNoNode: 'ноды пока нет',
    directionDown: 'вне',
    outShort: 'вне',
    reaches: 'Доступен',
    reachesNobody: 'никому',
    policies: 'Политики',
    plainOnly: 'только обычный',
    tag: 'тег {{tag}}',
    push: {
      ok_one: '{{count}} нода применила конфиг',
      ok_few: 'все {{count}} ноды применили конфиг',
      ok_many: 'все {{count}} нод применили конфиг',
      ok_other: 'все {{count}} нод применили конфиг',
      okShort: 'применён',
      pending: 'ещё не применили: {{names}}',
    },
    deleted: 'Каскад удалён',
    saved: 'Каскад сохранён',
    provisioning: 'Применяем конфиг на узлах...',
    provisioned: 'Все узлы применили новый конфиг.',
    provisionWaiting: 'Пока не ответили: {{nodes}}',
    // Каскад сломан (E46): фраза сервера «<нода>: <причина>» как есть.
    provisionBroken: 'Каскад сломан: {{broken}}',
    provisionUnknown: 'Сохранено, но статус применения прочитать не удалось.',
    modeBalancer: 'Балансер (auto-выход)',
  },
  // Страница метаданных подписки: всё, что /sub/:token рассказывает о себе.
  metadata: {
    title: 'Метаданные',
    subtitle:
      'Заголовки, которые клиент читает рядом с подпиской, и пресет по умолчанию для тех, кому сквад не назначил свой.',
    appliesOnFetch: 'Дойдёт при следующем запросе',
    reset: 'Сбросить',
    saving: 'Сохраняем...',
    saved: 'Метаданные подписки обновлены',
    headersTitle: 'Заголовки для клиента',
    profileTitle: 'Название профиля',
    profileTitleHint: 'Название подписки внутри клиента. Пусто: возьмётся имя бренда.',
    interval: 'Интервал обновления (часы)',
    intervalHint: 'Как часто клиент сам перетягивает подписку.',
    supportUrl: 'Ссылка на поддержку',
    supportUrlHint: 'Кликабельная ссылка на странице профиля в клиенте.',
    announce: 'Шаблон объявления',
    announceHint: 'Баннер внутри клиента. Пусто: заголовок не отдаётся вообще.',
    insertPlaceholder: 'Вставить по курсору',
    previewTitle: 'Что получает клиент',
    previewHint:
      'Отрисовано для примерного пользователя. Subscription-Userinfo берётся из состояния юзера и здесь не настраивается; название и объявление уходят в base64, как того и ждут клиенты.',
    omitted: 'заголовок не отдаётся',
    presetTitle: 'Пресет по умолчанию',
    presetHint:
      'Выдаётся тем, кому сквад не назначил свой. Содержимое пресетов редактируется в Routes, здесь только выбор.',
    presetEditLink: 'Редактировать пресеты в Routes',
    presetEditWhere: 'правила на устройстве',
    presetProxyAll: 'Всё через туннель',
    presetProxyAllHint: 'Весь трафик идёт через прокси. Поведение по умолчанию.',
    presetRuSplit: 'Умный сплит для РФ',
    presetRuSplitHint:
      'Реклама и малварь в блок, российские сайты и локальные адреса напрямую, остальное через туннель.',
    presetCnSplit: 'Сплит для Китая',
    presetCnSplitHint: 'То же самое, но для китайских сайтов и с чистым китайским DNS.',
    fragmentTitle: 'TLS-фрагментация',
    fragmentHint:
      'Дайлит каждый сервер через fragment-outbound, который рубит ClientHello на куски, так что DPI по SNI не может его чётко опознать. Только формат Xray JSON.',
  },
  // Подпись на каждое имя формата подписки, ОДНА на панель: её читают экран
  // хоста, настройка «формат по умолчанию» и правило выдачи. Состав стережёт
  // contours/subscription/lib/srrFormats.test.ts.
  //
  // Это КОРОТКОЕ имя, а не описание. Описания живут отдельно
  // (`delivery.format.*`) и отвечают на другой вопрос: не «как называется», а
  // «что это даёт клиенту».
  formatName: {
    plain: 'Ссылки (plain)',
    json: 'JSON',
    clash: 'Clash / Mihomo',
    singbox: 'sing-box',
    wgconf: 'WireGuard .conf',
    amneziavpn: 'AmneziaVPN',
    xrayjson: 'Xray JSON',
    'xrayjson-array': 'Xray JSON (массив)',
    xkeen: 'XKeen',
    outline: 'Outline',
    surge: 'Surge',
    quantumultx: 'Quantumult X',
    loon: 'Loon',
  },
  // Процесс цепи на ноде. Читается парой полей, см. lib/domain/chainStatus.ts:
  // молчание ноды это «нет данных», а не поломка.
  chain: {
    tag: 'ЦЕПЬ НЕ РАБОТАЕТ',
    downTitle: 'Процесс цепи на ноде не запущен',
    downNote: 'Строка снимется сама, как только нода отчитается о работающем процессе.',
    downNoReason: 'Процесс цепи не работает, причину нода не назвала',
    noData: 'Цепь послана, нода о ней ещё не отчиталась',
    up: 'Цепь работает',
    upVersion: 'Цепь работает · {{version}}',
    // В строке позиции нода называется по имени: их там несколько, и без имени
    // непонятно, о какой из них речь.
    noteDown: '{{name}}: процесс цепи не работает. {{reason}}',
    noteDownNoReason: '{{name}}: процесс цепи не работает, причину нода не назвала.',
    noteNoData: '{{name}}: цепь послана, нода о ней ещё не отчиталась.',
  },
} as const;
