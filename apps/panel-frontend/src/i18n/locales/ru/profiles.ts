export const profiles = {

  profiles: {
    emptyTitle: 'Профилей пока нет',
    emptyBody: 'Профиль это один протокол со своими настройками: чем нода слушает и что набирает клиент. Начните с рецепта, он заполнит поля, в которых легко ошибиться.',
    emptyFromRecipe: 'Начать с рецепта',
    emptyBlank: 'Чистый профиль',

    telegramPreview: {
      banner: 'Можно заполнить, сохранить пока нельзя',
      bannerHint:
        'Поля живые, но значения остаются на этой странице: бэкенд такой вход ещё не принимает, ничего не отправляется и сервером не проверяется. Профиль для Telegram прямо сейчас создают MTProto, SOCKS5 и HTTP.',
      saveBlocked: 'Бэкенд этот вход ещё не знает; поля можно заполнить, чтобы увидеть форму',
      web: {
        title: 'TELEGRAM WEB CONFIG',
        hostLabel: 'Хост веб-прокси *',
        hostPlaceholder: 'proxy.example.com',
        hostNote: 'Домен с настоящим сертификатом, без https:// и порта. HTTPS и 443 зашиты в сам вид.',
        hostBad: 'Только имя домена: без https://, порта и пути. Путь ниже, отдельным полем.',
        keyLabel: 'Секрет *',
        keyPlaceholder: '32 символа hex',
        keyGenerate: 'Сгенерировать',
        keyBad: 'Нужно ровно 32 символа hex.',
        keyNote:
          'Обычный клиентский секрет MTProxy, 16 байт. Кнопка делает его здесь, в браузере. Всё, что человек вводит у себя, это хост и секрет.',
        pathLabel: 'Базовый путь',
        pathPlaceholder: 'необязательно',
        pathNote: 'Если прокси живёт под путём, а на корне сайт. С путём секрет в ссылке меняет вид на base64url: так требует Telegram.',
        pathBad: 'В пути только буквы, цифры и . _ ~ -, сегменты через /.',
        carrierLabel: 'Носитель',
        carriers: {
          https: 'Один POST по очереди и один long poll на все потоки.',
          'https-lanes': 'Свой POST и свой long poll на каждый поток.',
          websocket: 'Один WebSocket, все потоки внутри.',
          'websocket-lanes': 'Свой WebSocket на каждый поток.',
        },
        linkLabel: 'Ссылка для клиента',
        linkWait: 'Появится, когда будут хост и секрет.',
        linkBad: 'Ссылки нет: одно из полей выше Telegram не примет.',
        linkNote: 'Собрана по формату эталонного relay. Сейчас это предпросмотр: страница подписки её не отдаёт.',
        warn: 'Клиент предупреждает пользователя: провайдер такого прокси крутит веб-страницу в фоне и может показать спонсорский канал. Трафик при этом не раскрывается, но доверие требуется.',
        stackTitle: 'Что панель поднимет на ноде',
        stackHint: 'Три слоя вместо одного демона. Это не протокол, это стек.',
        caddyPort: '443 наружу',
        relayPort: '8080 и 8081, локально',
        mtproxyPort: '2398, локально',
        portWarn:
          '443 на этой ноде должен быть свободен. У нас он обычно занят REALITY или hysteria.',
      },
    },

    generate: {
      hosts_one: 'хост',
      hosts_few: 'хоста',
      hosts_many: 'хостов',
      hosts_other: 'хостов',
      nodes_one: 'нода на пересборку',
      nodes_few: 'ноды на пересборку',
      nodes_many: 'нод на пересборку',
      nodes_other: 'нод на пересборку',
      configs: 'конфигов протухнет',
      configsPending: 'Панель пока не умеет их считать: для этого пришлось бы прогнать сборку подписки для каждого участника каждого сквада, который достаёт до этого профиля.',
      body: 'Ключ принадлежит профилю, поэтому одну и ту же пару отдают все ноды всех его хостов. Замена срабатывает везде разом, и старого ключа больше нет.',
      confirmTitle: 'Заменить пару ключей?',
      confirmBody: 'Профиль раздают {{hosts}} хостов на {{nodes}} нодах. Новый ключ уедет на все, и каждый уже выданный конфиг перестанет работать.',
      confirmAction: 'Заменить',
    },    bar: {
      profiles: 'ПРОФИЛЕЙ',
      inUse: 'В РАБОТЕ',
      unused: 'НЕ ИСПОЛЬЗУЮТСЯ',
    },
    allProtocols: 'Все протоколы',
    configButton: 'Настройки {{core}}',    engine: {
      native: 'Нативный демон',
      xray: 'Ядро Xray',
      singbox: 'Sing-box',
      telegram: 'Telegram',
      hint: 'Вкладка решает, какой бинарь поднимется на ноде',
      tabHint: {
        native: 'Каждый протокол тут поднимает свой процесс',
        xray: 'Вкладка решает, какой бинарь поднимется на ноде',
        singbox: 'Один бинарь закрывает все шесть протоколов',
        telegram: 'Ровно те четыре вида, что предлагает сам клиент Telegram',
      },
      coreVersion: 'Версия ядра',
      // Версия ядра на форме профиля: пин манифеста и парк против него.
      pin: 'пин',
      noPin: 'пина нет',
      noPinWhy: 'Пина нет: {{reason}}',
      component: {
        xray: 'xray',
        singbox: 'sing-box',
        hysteria: 'hysteria',
        'amneziawg-module': 'AWG модуль',
        'amneziawg-tools': 'AWG tools',
        mtg: 'mtg',
        mita: 'mita',
        'caddy-naive': 'caddy-naive',
      },
      fleet: '{{onPin}} из {{total}} нод на пине, {{other}} иначе, {{silent}} не сообщили',
      fleetUnpinned: '{{reported}} из {{total}} нод сообщили версию, {{silent}} не сообщили',
      fleetNone: 'Ни одна нода не сообщила это ядро',
      otherTitle: 'Иначе:',
      reportedTitle: 'Сообщили:',
      silentTitle: 'Не сообщили:',
      coreVersionHint:
        'Версия ядра это свойство ноды: один процесс обслуживает все профили этого ядра. Поменять можно на странице ноды, секция «Ядра».',
      toNodes: 'К нодам',
      // WEB: компонента в манифесте нет, парк не считается.
      webNoCore: 'Ядро для WEB (tproxy-server, MTProxy, Caddy) панель ещё не ставит и не пинит; появится с фазой WEB.',
    },
    title: 'Профили',
    subtitle: 'Шаблоны inbound-ов: один профиль может разворачиваться на нескольких нодах',
    create: 'Создать',
    refresh: 'Обновить',
    searchPlaceholder: 'Поиск по имени или описанию…',
    emptyFiltered: 'Ничего не найдено по фильтру.',
    deployToNodes: 'Развернуть на нодах',
    // Обе подсказки обещали клик, а плашка кликом не была: обещание висело
    // мёртвым, пока раскатка жила только в подсказке после создания профиля.
    // Теперь обе ведут на экран хоста с уже выбранным профилем.
    bindingsTooltipNone: 'Нигде не развёрнут. Открыть хост и выбрать ноду.',
    bindingsTooltipDeployed: 'Сколько нод его отдают. Открыть хост и добавить ещё одну.',
    deployHere: 'Развернуть на ноде',
    usersTooltip: 'Юзеров с доступом через сквады: {{count}}',
    deleteTitle: 'Удалить профиль «{{name}}»?',
    deleteWithBindings: 'Профиль развёрнут на {{count}} нодах. Удаление снимет его со всех нод (cascade) и аннулирует подписки на этот протокол у затронутых пользователей.',
    deleteSafe: 'Профиль не привязан ни к одной ноде - действие безопасное.',
    notify: {
      created: 'Профиль создан',
      createdOpenDeploy: 'Профиль создан. Выбери ноды + порт для деплоя →',
      updated: 'Профиль обновлён',
      deleted: 'Профиль удалён',
    },
    form: {
      titleCreate: 'Создать профиль',
      titleEdit: 'Профиль: {{name}}',
      name: 'Имя',
      protocol: 'Протокол',
      protocolEdit: 'Нельзя менять после создания',
      description: 'Описание',
      descriptionPlaceholder: 'Для чего этот шаблон',
      submitCreate: 'Создать профиль',
      submitEdit: 'Сохранить',
      plain: {
        onXray: 'на ядре xray: тот же процесс, что у остальных xray-профилей ноды, нового бинаря нет',
        fixed: 'Без TLS, REALITY и транспорта: клиенты Telegram говорят с таким прокси напрямую по TCP, выбирать здесь нечего.',
        auth: 'Вход всегда по логину и паролю пользователя: у каждого свои, имя и его UUID, на экране они не вводятся. Входа без пароля нет: открытый прокси на публичной ноде возил бы чужой трафик.',
        portSocks: 'Порт задаётся при развёртывании на ноду, по умолчанию 1080, и проходит ту же проверку порта, что у всех.',
        portHttp: 'Порт задаётся при развёртывании на ноду, по умолчанию 3128, и проходит ту же проверку порта, что у всех. 8080 не предлагается: там API xray.',
        udp: 'UDP выключен: Telegram через SOCKS5 UDP не использует.',
        httpClients: 'Только Telegram Desktop, ссылки для добавления у Telegram нет: адрес, порт, логин и пароль человек вводит руками. Туннель CONNECT, только TCP.',
        digest: 'Схема Basic; Digest не поддерживается ни ядром, ни клиентом Telegram. Basic это логин и пароль в base64, а не шифрование.',
        noObfs: 'Без обфускации: для сетей, где прокси разрешён, не для обхода DPI. Ни SOCKS5, ни HTTP сами ничего не шифруют.',
      },
      cfg: {
        salamanderObfsLabel: 'Пароль для obfs (Salamander)',
        salamanderObfsDesc: 'Опционально. Пусто, без обфускации.',
        masqueradeUrlLabel: 'URL для маскировки',
        brutalUpLabel: 'Brutal CC, ↑ Mbps',
        brutalDownLabel: 'Brutal CC, ↓ Mbps',
        realityDestDesc: 'host:port, фронт для прикрытия',
        stepProtocol: '1 · Протокол',
        stepTransport: '2 · Транспорт',
        stepSecurity: '3 · Защита',
        keypairLabel: 'Ключевая пара',
        keypairPlaceholder: 'не сгенерирована',
        serverNamesLabel: 'Server names',
        shortIdsLabel: 'Short IDs',
        basicsTitle: 'Основное',
        configTitle: 'Конфиг {{protocol}}',
        advHint: 'опционально',
        awgMimicryTitle: 'Дополнительно: пакеты-мимикрия I1-I5 (опционально)',
        awgMimicryDesc:
          'Фича AmneziaWG v2.0: маскирует handshake под другой протокол (QUIC / DNS / STUN). Нужно ТОЛЬКО если стандартный TSPU/Mobile preset не проходит DPI. Пустые поля = выключено, безопасно. Значения hex, до 256 символов каждое, ДОЛЖНЫ совпадать с клиентом.',
        realityModeLabel: 'Режим REALITY',
        realityModeDesc: 'Как REALITY заимствует TLS-личность',
        realityModeStealOthers: 'steal-from-others (внешний декой)',
        realityModeSelfSteal: 'self-steal (локальный fallback, РФ-2026)',
        singboxXrayOnly: 'На sing-box только REALITY (steal-others) по raw; TLS, self-steal и другие транспорты на ядре xray.',
        realityModeSelfStealHint:
          'Self-steal: нода поднимает локальный TLS-fallback, dest REALITY смотрит на него. В поле ниже укажите домен, резолвящийся в IP ЭТОЙ ноды, чтобы SNI и IP совпадали (переживает whitelist-shutdown в РФ). dest игнорируется.',
        realityFallbackUpstreamLabel: 'Реалистичный fallback (G1, опц.)',
        realityFallbackUpstreamDesc:
          'http(s) URL реального сайта: локальный fallback reverse-proxy на него отдаёт зонду настоящий контент вместо заглушки. Пусто = статичная страница.',
        realitySelfStealDomainLabel: 'Свой домен (должен указывать на IP ноды)',
        realitySelfStealDomainDesc:
          'A-запись этого домена на IP ЭТОЙ ноды. Нода поднимает локальный TLS-серт под него, REALITY использует его как serverName: SNI и IP консистентны.',
        realityServerNamesDesc: 'через запятую',
        realityShortIdsDesc: 'hex, через запятую',
        realityFingerprintDesc: 'TLS fingerprint клиента',
        realityPrivateKeyDesc: 'curve25519 base64. «Сгенерировать» или вставить из `xray x25519`.',
        realityPublicKeyDesc: 'вычисляется автоматически из private',
        realitySubprotocolDesc: 'VLESS поддерживает Vision. Trojan, авторизация по паролю.',
        realitySubprotocolVless: 'VLESS (рекомендуется)',
        realitySubprotocolTrojan: 'Trojan (без Vision)',
        realityFlowDesc: 'Vision работает только с raw',
        realityFlowNone: '(нет), без flow',
        realityNetworkDesc: 'REALITY: только raw / xhttp / grpc',
        realityNetworkRaw: 'raw (TCP), совместим с Vision',
        xhttpPathDesc: 'HTTP path для транспорта xhttp',
        hostHeaderDesc: 'опционально, по умолчанию = SNI',
        grpcServiceNameDesc: 'имя gRPC-сервиса',
        // B3 продвинутые опции (xray)
        advTitle: 'Дополнительно: REALITY, TLS, тюнинг транспорта',
        advRealityTab: 'REALITY',
        advTlsTab: 'TLS',
        advTransportTab: 'Транспорт',
        advRealityInactive: 'Применимо только при security = REALITY.',
        advTlsInactive: 'Применимо только при security = TLS (свой серт).',
        advTransportInactive: 'Применимо только для транспорта xhttp или gRPC.',
        realityXverLabel: 'REALITY xver',
        realityXverDesc: 'HTTP-версия для декоя: 0 = авто, 1 = HTTP/1.1, 2 = HTTP/2',
        realityMaxTimeDiffLabel: 'Макс. расхождение времени (мс)',
        realityMaxTimeDiffDesc: 'Допустимый сдвиг часов, мс. 0 = без ограничения',
        // G защита от пробинга: душим неверифицированный fallback
        realityFallbackRateGroup: 'Лимит fallback (защита от пробинга)',
        realityLimitFallbackUploadLabel: 'Лимит отдачи (байт/с)',
        realityLimitFallbackUploadDesc: 'Душит отдачу неверифицированного fallback: пробер видит медленный сайт. 0 = выкл',
        realityLimitFallbackDownloadLabel: 'Лимит загрузки (байт/с)',
        realityLimitFallbackDownloadDesc: 'Душит загрузку неверифицированного fallback: пробер видит медленный сайт. 0 = выкл',
        tlsRejectUnknownSniLabel: 'Отклонять неизвестный SNI',
        tlsRejectUnknownSniDesc: 'Рвать handshake, если SNI клиента не в сертификате',
        xhttpModeLabel: 'Режим xhttp',
        xhttpModeDesc: 'Фрейминг пакетов: auto, packet-up, stream-up или stream-one',
        xhttpPaddingBytesLabel: 'Padding xhttp (байты)',
        xhttpPaddingBytesDesc: 'Диапазон случайного padding, напр. 100-1000. Пусто = выкл',
        grpcMultiModeLabel: 'gRPC multiMode',
        grpcMultiModeDesc: 'Включить gRPC multi-mode (параллельные потоки). Клиент должен совпадать',
        generate: 'Сгенерировать',
        regenerate: 'Перегенерировать',
        awgSubnetLabel: 'Подсеть (CIDR)',
        awgSubnetHint: 'Не берите 10.0.0.0/24, она сталкивается с сетью некоторых хостеров',
        awgSubnetLockedHint: 'Менять после выдачи ключей нельзя: пиры уже сидят в этой сети',
        awgServerPrivLabel: 'Приватный ключ сервера',
        awgServerPubLabel: 'Публичный ключ сервера',
        awgServerPubPlaceholder: 'появится после генерации',
        awgPresetLabel: 'Пресет обфускации',
        awgKeepZero: 'держать 0',
        awgS1Desc: 'должен отличаться',
        awgJDesc: 'попарно уникален',
        awgHDesc: '> 4 и уникальны',
        awgHWarning:
          'H1-H4 должны быть попарно уникальны, сейчас есть дубликаты. Жми «Re-roll» чтобы сгенерировать заново.',
        naiveHostnameLabel: 'Публичный хост',
        naiveTlsEmailLabel: 'Email для TLS-сертификата',
        naiveMasqueradeLabel: 'Корень маскировки',
        ssCipherLabel: 'Метод шифрования',
        ssNote:
          'Пароль на пользователя = его xrayUuid. Включи у юзера протокол shadowsocks в списке протоколов.',
        mtprotoDomain: 'Domain для маскировки',
        mtprotoDomainNote:
          'Смена домена ротирует секреты ВСЕХ юзеров, старые подписки перестанут работать.',
        mieruMtu: 'MTU',
      },
    },
    deploy: {
      title: 'Развернуть «{{name}}» на нодах',
      hint: 'Отметь ноды, на которых нужен этот профиль. Снятые галки удаляют существующие bindings (cascade - пользователи теряют URL\'ы для этой ноды). Порт для новых bindings: {{port}}.',
      port: 'Порт для новых bindings',
      portAutoHint: 'Свободный порт подобран на выбранной ноде. Можно изменить.',
      portPlainHint: '{{port}}: порт, который ждут клиенты. Не подбирается, а проверяется: строка под каждой отмеченной нодой скажет, свободен ли он там.',
      noNodes: 'Нод нет - сначала создай ноду в разделе Nodes.',
      saved: 'Развернут: +{{added}} / снят: -{{removed}}',
      noChanges: 'Изменений нет',
      submit: 'Сохранить',
    },
  },
  profileEdit: {
    newTitle: 'Новый профиль',
    newCrumb: 'НОВЫЙ',
    engineRefused: 'Сервер отказал: этот протокол не работает на выбранном движке. SOCKS5 и HTTP обслуживает только ядро xray.',
    // Отказ гейта BACK (0c7dcc7): xray-семейство на sing-box, поле не то.
    singboxXrayRefused: 'На sing-box только REALITY (steal-others) по raw: поле «{{field}}».',
    singboxXrayRefusedBinding: 'На sing-box только REALITY (steal-others) по raw: поле «{{field}}» в переопределениях привязки.',
    singboxXrayField: {
      network: 'транспорт',
      security: 'защита',
      realityMode: 'режим REALITY',
    },
    newSubtitle: 'ВЫБЕРИТЕ ПРОТОКОЛ И ОПИШИТЕ ШАБЛОН',
    editSubtitle: 'ИЗМЕНЕНИЯ УЕДУТ НА КАЖДУЮ НОДУ С ЭТИМ ПРОФИЛЕМ',
    // Дверь к POST /api/profiles/:id/test-connect (slice 31): панель сама
    // стучится на каждую привязку профиля, без ssh на ноду.
    testConnect: 'Проверить подключение',
    // Окно развёртывания на несколько нод разом: снять привязку галкой и
    // получить подсказку свободного порта умеет только оно.
    deploy: 'Развернуть на нодах',
    notFound: 'Такого профиля больше нет.',
    backToList: 'К списку профилей',
    create: 'Создать профиль',
  },

  // Окно проверки подключения (slice 31). Панель сама стучится на каждую
  // привязку профиля из своего контейнера, без ssh на ноду.
  testConnect: {
    title: 'Проверка подключения',
    scope:
      'Проверка идёт из сети контейнера панели: DNS, фаервол, TLS-рукопожатие. Доступность у конечного пользователя она НЕ доказывает, его провайдер всё ещё может блокировать.',
    running: 'Проверяем каждую привязку и каждый хост…',
    failed: 'Проверка не удалась',
    empty: 'У этого профиля нет включённых привязок, проверять нечего.',
    rerun: 'Проверить ещё раз',
    close: 'Закрыть',
    sniHint: 'SNI, который мы отправили',
    certHint: 'CN сертификата на той стороне: у REALITY это должен быть сайт маскировки, а не ваш домен',
    tlsHint: 'Согласованная версия TLS: цели маскировки REALITY нужен TLSv1.3',
    record: 'запись хендшейка {{bytes}} байт из {{limit}}',
    recordHint:
      'Самая длинная запись первого ответа цели, с заголовком. REALITY-сервер ретранслирует её и сдаётся на записи больше {{limit}} байт: хендшейк не завершается ни разу.',
  },

  profileForm: {
    nameLatinOnly: 'Только латиница, цифры, точка, _ и -. Без пробелов и кириллицы.',
    awgImportantTitle: 'Что важно знать про AmneziaWG 2.0:',
    awgImportant1:
      'Клиент: AmneziaVPN ≥ 4.8.12.9 или Hiddify Next ≥ 2.4. Старые не подключатся.',
    awgImportant2:
      'Порт выберешь на следующем шаге («Развернуть на нодах»). Рекомендация: ≤ 9999, например 443 или 1234. Не используй 51820 - известный WG-default, ISP его режут.',
    awgImportant3:
      'При миграции со старого AmneziaWG 1.0 - все ключи peer\'ов нужно перегенерить, со старыми не работает.',
    deployHintAwgPort: 'Для AmneziaWG: ≤ 9999, например 443 или 1234. 51820 не используй.',
    // Старая пара текстов читала node.protocol как ограничение. Это ярлык
    // основного адаптера, а не список того, что нода умеет: нода с ярлыком
    // tuic штатно несёт xray-профиль рядом. Теперь вопрос один: есть ли
    // нужное ядро среди тех, что нода СООБЩИЛА о себе.
    nodeWillRun: 'Нода сообщила, что несёт {{wanted}}. Профиль на ней поедет.',
    nodeWillNotRun:
      'Профилю нужно {{wanted}}, а нода сообщила только: {{engines}}. Привязка создастся, но обслуживать её будет нечем: ссылка в подписке укажет на порт, который никто не слушает.',
    nodeEnginesUnknown:
      'Нода ещё не сообщала, какие ядра на ней стоят, поэтому про совместимость сказать нечего. "{{protocol}}" это ярлык основного адаптера при установке, а не список возможностей: нода с одним ярлыком штатно несёт профили других протоколов рядом.',
    // Сервер знает intendedEngines: вместо ярлыка ядра, на которые нода
    // настроена. Это намерение, не отчёт, поэтому вывода про профиль нет.
    nodeEnginesIntended:
      'Нода ещё не сообщала, какие ядра на ней стоят, поэтому про совместимость сказать нечего. Здесь ядра, на которые она настроена: это намерение, а не отчёт о машине.',
    portRangeStart: 'Начало диапазона портов',
    portRangeStartDesc: 'UDP port-hopping для обхода РФ TSPU. Пусто - один порт.',
    portRangeEnd: 'Конец диапазона портов',
    portRangeEndDesc: 'Должен быть > начала. iptables-диапазон на ноде должен покрывать этот.',
  },
  recipes: {
    searchPlaceholder: 'Поиск рецептов…',
    countLine: '{{shown}} из {{total}} рецептов · встроенный реестр',
    emptyForKind: 'Встроенных рецептов для {{kind}} нет. Импортируйте свой или сохраните этот профиль как рецепт.',
    title: 'Рецепты быстрой настройки',
    subtitle: 'Клик - поля ниже заполнятся под выбранный сценарий. Ручная правка остаётся доступной.',
    appliedBadge: 'RECIPE ПРИМЕНЁН',
    appliedAlert: 'Применён: {{name}}',
    dpiLabel: 'DPI',
    speedLabel: 'Speed',
    registry: {
      title: 'Реестр сообщества',
      loading: 'Загрузка рецептов сообщества...',
      offline: 'Реестр сообщества недоступен, только встроенные рецепты.',
      // По источнику: почему не пришли рецепты (sources[] ответа реестра).
      reason: {
        'not-found': 'Реестр {{name}} не найден (404): репозитория нет',
        unreachable: 'Реестр {{name}} недоступен, попробуйте позже',
        invalid: 'Реестр {{name}} ответил не списком рецептов',
        unknown: 'Реестр {{name}} не отдал рецепты',
      },
      staleBadge: 'кэш',
      official: 'official',
      community: 'community',
      byAuthor: 'автор: {{author}}',
      regionAll: 'Все',
      region: {
        GLOBAL: 'Глобал',
        RU: 'RU',
        IR: 'IR',
        CN: 'CN',
        BY: 'BY',
      },
    },
    import: {
      button: 'Импорт',
      title: 'Импорт рецепта',
      hint: 'Вставь raw-URL (свой gist / GitHub) или JSON рецепта. Он валидируется, потом выбираешь какой применить. Ничего не сохраняется.',
      urlLabel: 'URL рецепта',
      jsonLabel: 'или вставь JSON рецепта',
      load: 'Загрузить',
      pick: 'Выбери, что применить:',
      none: 'Валидных рецептов не найдено.',
      failed: 'Импорт не удался',
      wrongProtocol: 'Для {{protocol}} там ничего нет (сюда применим только этот протокол).',
      hidden: 'Скрыто рецептов для других протоколов: {{count}}.',
    },
    export: {
      button: 'Экспорт в рецепт',
      title: 'Экспорт в рецепт',
      hint: 'Сохрани текущий конфиг как JSON-рецепт, положи его в свой GitHub-источник рецептов и поделись.',
      nameLabel: 'Название',
      namePlaceholder: 'Мой RU-конфиг',
      descLabel: 'Описание',
      regionLabel: 'Регион',
      download: 'Скачать JSON',
      filename: 'файл: {{name}}.json',
    },
    cards: {
      'xray-reality-vision-raw': {
        name: 'REALITY + Vision (raw)',
        description: 'Канонический stealth - маскировка под HTTPS-сайт',
        details:
          'VLESS + REALITY + Vision flow поверх raw TCP. Трафик выглядит для DPI как обычный HTTPS-запрос на крупный CDN-сайт (Cloudflare/Apple/etc). Vision flow добавляет zero-copy splice - самый быстрый путь без потери на маскировке. Это рекомендуемый дефолт для большинства ситуаций.',
        notes: [
          'Vision работает только с raw - не меняй транспорт после применения recipe',
        ],
      },
      'xray-reality-xhttp': {
        name: 'REALITY + xhttp (HTTP/2 chunked)',
        description: 'Для жёсткого DPI который режет VLESS+raw',
        details:
          'VLESS + REALITY + xhttp transport. Трафик уезжает в HTTP/2 chunked-stream - выглядит как обычный HTTP/2 запрос (выпадает в общую массу h2 трафика к CDN). Чуть медленнее raw (≈10-15% потери на framing), но обходит DPI который начал резать REALITY+raw в некоторых ISP. Без Vision - для xhttp Vision не работает.',
        notes: [
          'Path рандомизирован - не показывай его публично',
          'Если REALITY+raw блокируется в твоей сети - xhttp обычно ещё работает',
        ],
      },
      'xray-trojan-reality': {
        name: 'Trojan + REALITY',
        description: 'Password-auth вместо UUID, anti-probe defense',
        details:
          'Trojan через xray-core + REALITY. Пользователи аутентифицируются паролем (мы используем user.xrayUuid как пароль). При неверной аутентификации сервер возвращает реальный HTTPS-ответ с decoy-сайта - anti-probe защита. Без Vision (Trojan его не поддерживает). Полезно для legacy-клиентов которые не умеют VLESS.',
      },
      'hysteria-default': {
        name: 'Hysteria 2 (clean)',
        description: 'UDP, низкая latency, без obfs - для свободных регионов',
        details:
          'Hysteria 2 поверх QUIC (UDP) без обфускации. Самая низкая latency (UDP без TCP-handshake) и хорошая throughput через Brutal CC. Без obfs - DPI может обнаружить QUIC-трафик. Подходит для регионов без активного UDP-DPI.',
      },
      'hysteria-salamander': {
        name: 'Hysteria 2 + Salamander (RU mobile)',
        description: 'Obfuscation для обхода UDP-DPI на РФ-мобиле',
        details:
          'Hysteria 2 с Salamander obfuscation password. Каждый UDP-пакет XOR-шифруется производным от пароля ключом - DPI не видит QUIC-сигнатуру. На РФ мобильных (Megafon/MTS/Beeline) clean Hysteria часто throttled до tx:0; Salamander обычно проходит. Brutal CC параметры выставлены для пиков 100 Mbps.',
        notes: [
          'Obfs password сгенерирован случайно - не теряй его, нужен на клиентах',
          'Brutal CC 100/100 Mbps - настрой под реальную пропускную способность ноды',
        ],
      },
      'awg-default': {
        name: 'AmneziaWG (default)',
        description: 'Дефолтные obfs параметры - для большинства ISP',
        details:
          'AmneziaWG (форк WireGuard с DPI-bypass). Дефолтный preset Jc/Jmin/Jmax + S/H обфускации скрывает WireGuard-сигнатуру. Подходит для большинства провайдеров. На особо жёстких ISP попробуй «Iran-tuned».',
      },
      'awg-iran': {
        name: 'AmneziaWG (Iran-tuned)',
        description: 'Обфускация под иранский DPI',
        details:
          'AmneziaWG с параметрами обфускации, рекомендованными командой Amnezia для иранских ISP. Jc=4 (junk count), специфические S1-S4 паддинги, H1-H4 хедер-байты. На иранском DPI default-параметры не проходят, эти - да. Также часто помогают на корпоративных firewall.',
      },
      'naive-default': {
        name: 'NaiveProxy (Caddy)',
        description: 'HTTP/2 proxy с Chrome-fingerprint, защищён от probe',
        details:
          'NaiveProxy через Caddy fork. Трафик идёт в HTTP/2 как обычный HTTPS-запрос с правильным Chrome JA3 fingerprint. ACME cert от Let\'s Encrypt автоматически. Один из самых stealth-вариантов для регионов где xray и hysteria уже забанены.',
        notes: [
          'Hostname и tlsEmail заполни вручную - нужен реальный домен с A-записью на ноду',
        ],
      },
      'ss-2022-blake3': {
        name: 'SS-2022 (blake3-aes-256)',
        description: 'Современный Shadowsocks - XChaCha20 уровень security',
        details:
          'Shadowsocks 2022 с шифром 2022-blake3-aes-256-gcm. Современная alternative AEAD - лучше по производительности и резистентности к probe-attacks чем legacy chacha20. Поддерживается актуальными клиентами (Shadowrocket, sing-box, Clash Meta); Outline шифры 2022 не понимает.',
      },
      'mtproto-default': {
        name: 'MTProto (Telegram)',
        description: 'Только для Telegram-клиента - отдельный use case',
        details:
          'MTProto-прокси для Telegram. Это НЕ general-purpose VPN - только Telegram-трафик. Один shared secret на все юзеры (upstream 9seconds/mtg ограничение). Полезно когда Telegram забанен но хочется быстрого канала именно для месседжера.',
      },
      'mieru-default': {
        name: 'Mieru (Chinese GFW)',
        description: 'Специально под Great Firewall - random padding',
        details:
          'Mieru от enfein - современный stealth-протокол с агрессивным паддингом, разработан против Chinese GFW. Трафик выглядит как noise - нет сигнатур. Поддерживается sing-box. Используй когда другие протоколы режутся в CN-mainland.',
      },
    },
  },
} as const;
