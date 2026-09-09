export const squads = {
  squads: {
    title: 'Внутренние сквады',
    subtitle: 'Group ACL: кто какие inbound-ы видит в подписке',
    create: 'Создать сквад',
    bar: {
      squads: 'СКВАДОВ',
      members: 'УЧАСТНИКОВ',
      withoutHosts: 'БЕЗ ХОСТОВ',
    },
    card: {
      system: 'СИСТЕМНЫЙ',
      hosts: 'ХОСТЫ',
      members: 'УЧАСТНИКИ',
      // Сквад режется по направлениям, а не по нодам под ними, поэтому колонка
      // названа тем, что она на самом деле ограничивает.
      exitsPolicies: 'НАПРАВЛЕНИЯ · ПОЛИТИКИ',
      noneGranted: 'ничего не выдано',
      allExits: 'все',
      of: 'из',
      noPolicies: 'нет',
      grantHosts: 'Выдать хосты',
    },
    refresh: 'Обновить',
    open: 'Открыть',
    searchPlaceholder: 'Поиск по имени или описанию…',
    empty: 'Сквадов нет.',
    allDefaultName: 'All',
    allDefaultDescription: 'Группа по умолчанию: новые пользователи попадают сюда автоматически.',
    deleteTitle: 'Удалить сквад «{{name}}»?',
    deleteBody: 'Пользователи останутся, но потеряют доступ к привязанным к этому скваду профилям. Если других сквадов нет, они вернутся в All.',
    deleteAllProtected: 'Сквад «All» защищён системой и не удаляется.',
    notify: {
      created: 'Сквад создан',
      updated: 'Сквад обновлён',
      deleted: 'Сквад удалён',
    },
    form: {
      titleCreate: 'Создать сквад',
      titleEdit: 'Редактировать сквад',
      name: 'Имя',
      namePlaceholder: 'Trial / VIP / Stage',
      description: 'Описание',
      descriptionPlaceholder: 'Зачем эта группа нужна (необязательно)',
      routing: 'Переопределение routing',
      routingDesc: 'Routing подписки для этого сквада. Наследовать = панельная настройка.',
      // Подписи отдельных пресетов живут в `metadata.preset*`: каждый пикер
      // строит варианты из общего списка id и переводит их в одном месте.
      routingInherit: 'Наследовать (дефолт панели)',
      hwidLimit: 'Лимит устройств HWID (дефолт сквада)',
      hwidLimitDesc: 'Дефолтный лимит устройств для членов без своего лимита. Пусто = нет. По сквадам выигрывает самый щедрый (max).',
      hwidLimitPlaceholder: 'Нет дефолта сквада',
      profiles: 'Профили',
      profilesSelected: '{{count}} выбрано',
      profilesSearch: 'Поиск по имени / протоколу…',
      profilesEmpty: 'Профилей в системе пока нет.',
      profilesNothingFound: 'Ничего не нашлось.',
      exitAcl: 'Выходы каскадов',
      exitAclHint:
        'Ограничьте, какие выходы балансера доступны этому скваду. Если в каскаде не отмечено ничего, разрешены все его выходы.',
      exitAclAll: 'все',
      policies: 'Политики маршрутизации',
      policiesHint:
        'Выдайте скваду ad-split политики. Обычный профиль доступен всегда; каждая выданная политика добавляет вариант на каждый выход (например «CH · Без рекламы»).',
      submitCreate: 'Создать',
      submitEdit: 'Сохранить',
      systemSquadTooltip: 'Системный сквад',
      profilesSelectedBadge: 'Профилей выбрано',
      membersBadge: 'Участников',
      allAlert:
        'All: системный сквад. Привязывается автоматически к каждому новому профилю и каждому новому пользователю. Переименовать, изменить состав или удалить нельзя.',
    },
  },

  squadForm: {
    builtinSystemTooltip: 'Системный сквад: автоматически отслеживает все inbound-ы',
    selectAll: 'Выбрать все',
    deselectAll: 'Снять все',
    deployedTooltip: 'Развёрнут на нодах',
    profileOffBadge: 'выкл.',
  },
} as const;
