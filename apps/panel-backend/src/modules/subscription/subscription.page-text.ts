/**
 * Тексты страницы подписки, оба языка.
 *
 * Отдельным файлом, потому что меняются они чаще всего остального, а
 * правка одной фразы открывала файл на две с половиной тысячи строк и
 * показывалась в diff вперемешку с вёрсткой. Здесь же видно, что вторая
 * колонка не отстала от первой: пропущенный ключ подсвечивает компилятор,
 * а не читатель страницы.
 */

export interface StepText {
  title: string;
  text: string;
}

export interface Labels {
  status: string;
  traffic: string;
  expires: string;
  username: string;
  /** Header actions. The short forms are what fits a phone: the buttons are
   *  half a screen wide there, and a clipped label is worse than a shorter one. */
  transfer: string;
  transferShort: string;
  copyLink: string;
  copyLinkShort: string;
  /** The line under the name. `{n}` is the already-pluralised day count. */
  noteActive: string;
  noteNoExpiry: string;
  noteExpiring: string;
  noteTrafficLow: string;
  /** The line for a subscription that is not in force, keyed by status. */
  noteStopped: Record<string, string>;
  /** day / days, in the three Russian forms and the two English ones. */
  days: readonly [string, string, string];
  telegram: string;
  telegramNote: string;
  pickPlatformBtn: string;
  /** Second level. `{p}` is the platform's own name. */
  allApps: string;
  allAppsNote: string;
  wholeList: string;
  showAll: string;
  hideAll: string;
  groupPlain: string;
  groupAdvanced: string;
  /** Steps. The shape is in code (icon, tint, order); only the words are here. */
  stepsGeneric: readonly StepText[];
  stepsTv: readonly StepText[];
  stepsRouter: readonly StepText[];
  enterOnTv: string;
  /** The downloads card. `formats` is keyed by the `?format=` value. */
  dlTitle: string;
  dlNote: string;
  dlWarn: string;
  dlGroupClients: string;
  dlGroupRouter: string;
  dlGroupOther: string;
  dlGet: string;
  /** Кнопка строки MTProto: ссылка открывается в самом мессенджере. */
  tgOpen: string;
  /** Поля HTTP-прокси, которые человек вводит в Telegram Desktop руками, и
   *  кнопка копирования пароля (UUID руками не набирают). */
  tgHttpFields: { server: string; port: string; login: string; password: string; copyPassword: string };
  /** Кнопки строки Outline: ключ ssconf:// копируется и открывается в приложении. */
  outlineOpen: string;
  dlCopyKey: string;
  dlCopy: string;
  dlDead: string;
  /** Подписи кнопок, что ведут за выбранным приложением и в него. */
  stepGet: string;
  stepAdd: string;
  /** Подсказка про точку, показывается только в раскрытом блоке конфигов. */
  dlHint: string;
  /** Когда подписке не выдано ни одного сервера. */
  noServersTitle: string;
  noServers: string;
  /** Короткое имя строки: чем формат ЯВЛЯЕТСЯ для читателя. */
  formatNames: Record<string, string>;
  formats: Record<string, string>;
  /** Transfer window. */
  transferTitle: string;
  transferNote: string;
  transferWarn: string;
  close: string;
  noExpiry: string;
  unlimited: string;
  protocols: string;
  subLink: string;
  /**
   * Said on the refusal page, under the link.
   *
   * That page has one thing a person can still act on, and it raises one
   * question every time: will I be given a new link. Answering it where the
   * link is shown is cheaper than answering it in support, and it stops people
   * throwing away a link that is about to work again.
   */
  deadLinkNote: string;
  copy: string;
  copied: string;
  copyKey: string;
  /** Stands in the place of a code that the browser has not drawn: with
   *  JavaScript off the reader gets the link itself and this one line, so the
   *  empty square does not read as a broken page. */
  qrNeedsJs: string;
  setup: string;
  scanTitle: string;
  /** Said BEFORE the code, not after: a person with three servers must learn
   *  it before they scan the first one they see. */
  oneTunnel: string;
  oneTunnelMany: string;
  support: string;
  routerLabel: string;
  statusValues: Record<string, string>;
}

export const L: Record<'ru' | 'en', Labels> = {
  en: {
    status: 'Status',
    traffic: 'Traffic',
    expires: 'Expires',
    username: 'Username',
    transfer: 'Another device',
    transferShort: 'Another device',
    copyLink: 'Copy link',
    copyLinkShort: 'Link',
    noteActive: 'Active, {n} left',
    noteNoExpiry: 'Active, no expiry date',
    noteExpiring: 'Expires in {n}, renew before it does',
    noteTrafficLow: '{left} of {total} left, and access stops at the limit',
    noteStopped: {
      expired: 'The subscription has run out. Renew it and this page works again, with the same link.',
      limited: 'The traffic allowance is used up. Access resumes when the allowance is renewed.',
      disabled: 'The subscription is switched off. Your operator can switch it back on.',
      revoked: 'This link has been withdrawn. Ask your operator for a new one.',
    },
    days: ['day', 'days', 'days'],
    telegram: 'Telegram',
    telegramNote:
      'MTProto, SOCKS5 or HTTP. Only the messenger itself, and only in the app: the web version has no proxy settings.',
    pickPlatformBtn: 'Device',
    allApps: 'All apps for {p}',
    allAppsNote: 'The ones above are enough. This is everything else that works.',
    wholeList: 'This is the whole list for {p}, not a selection.',
    showAll: 'Show',
    hideAll: 'Hide',
    groupPlain: 'INSTALL AND IT WORKS',
    groupAdvanced: 'FOR FINE CONTROL, HARDER',
    stepsGeneric: [
      {
        title: 'Install the app',
        text: 'Pick one above and install it from your system’s store or from its own site.',
      },
      {
        title: 'Add the subscription',
        text: 'Press the app’s card above and the subscription goes straight into it. Install the app first, or the system has nobody to hand the link to.',
      },
      {
        title: 'If nothing was added',
        text: 'Copy the link with the `Copy link` button above. In the app, open its list of profiles, add one from a URL and paste the link there.',
      },
      {
        title: 'Connect',
        text: 'Choose the profile you just added and turn the connection on. The system asks for VPN permission once.',
      },
    ],
    stepsTv: [
      {
        title: 'Install it on the television',
        text: 'Search for the app by name in the store on the television itself. If the firmware has no store, it installs as an apk through Downloader; ask your operator for the address.',
      },
      {
        title: 'Getting the subscription onto the television',
        text: 'The add button is no help here: the television cannot open a link pressed on your phone. It has no camera either, so there is nothing to scan the code with. The link is typed on the television, in the app’s add-by-URL field.',
      },
      {
        title: 'If typing with the remote is painful',
        text: 'Install your television’s remote-control app on your phone: it gives you a normal keyboard, and the link is pasted in seconds. On Android TV boxes, entering text through the Google account page does the same job.',
      },
      {
        title: 'Connect and use',
        text: 'Pick a server with the remote and connect; the television asks for VPN permission once. Keep the app in the recents list: some firmware evicts it from memory and the tunnel drops.',
      },
    ],
    stepsRouter: [
      {
        title: 'Configuration file',
        text: 'A router holds one connection at a time, so there is a file per server. Download the one you want to leave through.',
      },
      {
        title: 'Loading it into the router',
        text: 'On Keenetic: Internet, Other connections, add WireGuard and upload the file. On OpenWrt install amneziawg-tools and import the config under Network. From a console the file goes to /etc/amnezia/amneziawg and comes up with awg-quick.',
      },
      {
        title: 'Plain WireGuard will not do',
        text: 'The file carries the masking parameters Jc, S1, S2, H1 and H4. Firmware without AmneziaWG support does not understand them: the connection either fails to come up or comes up and is conspicuous. If your router only speaks classic WireGuard, install an app on the devices instead.',
      },
      {
        title: 'Check it, and what changes',
        text: 'Once the tunnel is up the whole home network goes through it, television and set-top box included, and those need no app of their own any more. Check the external address from any device: it should match the country of the server you chose.',
      },
      {
        title: 'If the subscription is not AmneziaWG',
        text: 'A router can carry the ordinary subscription too, just not as a file. On Keenetic that is Entware from a USB drive plus Xray; on OpenWrt the PassWall or HomeProxy package. The XKeen file is right here on this page, in the `take it as a config file` block below.',
      },
    ],
    enterOnTv: 'TYPE THIS ON THE TELEVISION',
    dlTitle: 'Take it as a config file',
    dlNote:
      'For when the app cannot be given a subscription link: a router, an offline machine, a client that only imports files.',
    dlWarn:
      'A config file carries your keys and passwords in plain text. Anyone who gets the file gets your access.',
    dlGroupClients: 'FOR CLIENTS ON THIS DEVICE',
    dlGroupRouter: 'FOR A ROUTER',
    dlGroupOther: 'FOR ANOTHER DEVICE',
    dlDead: 'While the subscription is not in force, no config is issued: these addresses answer with a refusal, the same one that brought you to this page. Everything comes back the moment it is renewed, on the same link.',
    dlGet: 'Download',
    tgOpen: 'Open in Telegram',
    tgHttpFields: { server: 'Server', port: 'Port', login: 'Login', password: 'Password', copyPassword: 'Password' },
    outlineOpen: 'Open in Outline',
    dlCopyKey: 'Key',
    dlCopy: 'Config',
    stepGet: 'Get',
    stepAdd: 'Add to',
    dlHint:
      'The dot marks what suits the platform you picked. The rest is left on purpose: a config is taken for another device more often than for this one.',
    noServersTitle: 'No servers yet. ',
    noServers:
      'This subscription has not been issued a single server, so there is nothing to name an app for and nothing to hand out as a config. It all appears here the moment the operator grants access, on this same link: you will not need to fetch it again.',
    formatNames: {
      clash: 'Clash-compatible',
      singbox: 'sing-box',
      xrayjson: 'Xray JSON',
      'xrayjson-array': 'Xray JSON, as an array',
      outline: 'Outline',
      surge: 'Surge',
      quantumultx: 'Quantumult X',
      loon: 'Loon',
      json: 'List of endpoints',
      xkeen: 'XKeen on Keenetic',
      wgconf: 'wg-quick / awg',
      amneziavpn: 'AmneziaVPN key',
      plain: 'Subscription link',
      mtproto: 'Telegram proxy',
      'tg-socks': 'Telegram, SOCKS5',
      'tg-http': 'Telegram, HTTP',
    },
    formats: {
      clash: 'Clash Verge, FlClash, Clash Mi. The whole subscription in one file',
      singbox: 'sing-box, Karing, Hiddify. The whole subscription in one file',
      xrayjson: 'v2rayN, Throne, Happ. The whole subscription in one file',
      'xrayjson-array': 'The same servers as separate configs, which is how Happ and v2RayTun read them',
      outline: 'An Outline access key: paste it into Add server, or open it. Shadowsocks, this server only',
      surge: 'iOS and macOS. Paid app',
      quantumultx: 'iOS. Paid app',
      loon: 'iOS. Paid app',
      json: 'The panel’s own list of endpoints, for tooling',
      xkeen: 'Keenetic with XKeen: outbounds and routing, no inbound',
      wgconf: 'One tunnel to one server, not the whole subscription',
      amneziavpn: 'Copy it and paste it into the app, which reads it itself. One tunnel to one server',
      plain: 'The subscription itself, base64. This is what a client pulls from the link',
      mtproto: 'Inside Telegram only, and nothing else goes through it. No config file carries it',
      'tg-socks': 'Opens the add-proxy dialog in Telegram, your own login inside. This server only',
      'tg-http': 'Telegram Desktop only: Settings, Advanced, Connection type, HTTP proxy. Enter the four fields by hand',
    },
    transferTitle: 'Move this to another device',
    transferNote:
      'Point a phone or tablet camera at it. The subscription opens there; nothing needs installing on this device.',
    transferWarn: 'Whoever gets this code gets your subscription. Do not post it anywhere.',
    close: 'Close',
    noExpiry: 'no expiry',
    unlimited: 'unlimited',
    protocols: 'Protocols',
    subLink: 'Subscription link',
    deadLinkNote:
      'The link does not change. Keep it: it starts working again as soon as the subscription does.',
    copy: 'Copy',
    copied: 'Copied',
    copyKey: 'Copy key',
    qrNeedsJs: 'The QR is drawn in the browser: turn JavaScript on, or copy the text above.',
    setup: 'Set up',
    scanTitle: 'AmneziaWG keys',
    oneTunnel: 'One key is one tunnel to one server, not the whole subscription.',
    oneTunnelMany: 'One key is one tunnel to ONE server, not the whole subscription. Pick the server first, then scan: importing all of them gives you one connection each, not a set that switches.',
    support: 'Support',
    routerLabel: 'Router',
    statusValues: {
      active: 'active',
      revoked: 'withdrawn',
      disabled: 'disabled',
      expired: 'expired',
      limited: 'limit reached',
    },
  },
  ru: {
    status: 'Статус',
    traffic: 'Трафик',
    expires: 'Истекает',
    username: 'Имя пользователя',
    transfer: 'Другое устройство',
    transferShort: 'Другое устройство',
    copyLink: 'Скопировать ссылку',
    copyLinkShort: 'Ссылка',
    noteActive: 'Активна, осталось {n}',
    noteNoExpiry: 'Активна, без срока',
    noteExpiring: 'Истекает через {n}, продлите заранее',
    noteTrafficLow: 'Осталось {left} из {total}, на лимите доступ остановится',
    noteStopped: {
      expired: 'Срок подписки закончился. Продлите, и страница снова заработает, ссылка та же.',
      limited: 'Лимит трафика исчерпан. Доступ вернётся, когда лимит обновят.',
      disabled: 'Подписка выключена. Включить её может оператор.',
      revoked: 'Эта ссылка отозвана. Запросите у оператора новую.',
    },
    days: ['день', 'дня', 'дней'],
    telegram: 'Телеграм',
    telegramNote:
      'MTProto, SOCKS5 или HTTP. Работает только сам мессенджер и только в приложении: в веб-версии полей прокси нет.',
    pickPlatformBtn: 'Устройство',
    allApps: 'Все приложения для {p}',
    allAppsNote: 'Тех, что выше, достаточно. Здесь всё остальное, что тоже работает.',
    wholeList: 'Это весь список для {p}, а не выборка.',
    showAll: 'Показать',
    hideAll: 'Скрыть',
    groupPlain: 'ПОСТАВИЛ И РАБОТАЕТ',
    groupAdvanced: 'ДЛЯ ТОНКОЙ НАСТРОЙКИ, СЛОЖНЕЕ',
    stepsGeneric: [
      {
        title: 'Установка приложения',
        text: 'Выберите приложение выше и поставьте его: в магазине своей системы или с сайта разработчика.',
      },
      {
        title: 'Добавление подписки',
        text: 'Нажмите карточку приложения выше, и подписка уйдёт прямо в него. Приложение должно быть уже установлено, иначе системе некому передать ссылку.',
      },
      {
        title: 'Если подписка не добавилась',
        text: 'Скопируйте ссылку кнопкой «Скопировать ссылку» вверху страницы. В приложении откройте список профилей, добавьте новый профиль по URL и вставьте её туда.',
      },
      {
        title: 'Подключение',
        text: 'Выберите добавленный профиль и включите подключение. Разрешение на VPN система спросит один раз.',
      },
    ],
    stepsTv: [
      {
        title: 'Установка на телевизор',
        text: 'Найдите приложение по названию в магазине на самом телевизоре. Если магазина на прошивке нет, приложение ставится apk через Downloader, адрес спросите у оператора.',
      },
      {
        title: 'Перенос подписки на телевизор',
        text: 'Кнопка добавления тут не поможет: телевизор не откроет ссылку, нажатую на телефоне. Камеры у телевизора тоже нет, сканировать код нечем. Поэтому ссылку вводят на самом телевизоре, в приложении это пункт добавления по URL.',
      },
      {
        title: 'Если вводить пультом неудобно',
        text: 'Поставьте на телефон приложение-пульт для своего телевизора: оно даёт обычную клавиатуру, и ссылка вставляется за несколько секунд. На приставках Android TV ту же роль выполняет ввод через аккаунт Google на странице устройства.',
      },
      {
        title: 'Подключение и использование',
        text: 'Выберите сервер пультом и нажмите подключение, телевизор один раз спросит разрешение на VPN. Держите приложение в списке недавних: на части прошивок система выгружает его из памяти и туннель рвётся.',
      },
    ],
    stepsRouter: [
      {
        title: 'Файл конфигурации',
        text: 'Роутер держит одно соединение за раз, поэтому файл свой на каждый сервер. Скачайте тот, через который хотите выходить.',
      },
      {
        title: 'Загрузка в роутер',
        text: 'На Keenetic: Интернет, Другие подключения, добавить WireGuard и загрузить файл. На OpenWrt поставьте пакет amneziawg-tools и импортируйте конфиг в разделе Network. Через консоль файл кладётся в /etc/amnezia/amneziawg и поднимается командой awg-quick.',
      },
      {
        title: 'Обычный WireGuard не подойдёт',
        text: 'В файле есть параметры маскировки Jc, S1, S2, H1 и H4. Прошивка без поддержки AmneziaWG их не поймёт: соединение либо не встанет, либо встанет и будет заметным. Если роутер умеет только классический WireGuard, ставьте приложение на устройства.',
      },
      {
        title: 'Проверка и правила',
        text: 'После подъёма туннеля через него пойдёт вся домашняя сеть, включая телевизор и приставку, отдельные приложения им уже не нужны. Проверьте внешний адрес с любого устройства: он должен совпасть со страной выбранного сервера.',
      },
      {
        title: 'Если подписка не на AmneziaWG',
        text: 'Роутер потянет и обычную подписку, только ставится она не файлом. На Keenetic это Entware с USB-накопителя и Xray, на OpenWrt пакет PassWall или HomeProxy. Готовый файл для XKeen лежит ниже, в блоке «Забрать конфигом».',
      },
    ],
    enterOnTv: 'ВВЕСТИ НА ТЕЛЕВИЗОРЕ',
    dlTitle: 'Забрать конфигом',
    dlNote:
      'На случай, когда приложению нельзя отдать ссылку подписки: роутер, машина без интернета, клиент, который умеет только файл.',
    dlWarn:
      'В файле конфигурации ключи и пароли лежат открытым текстом. Кто получит файл, получит и ваш доступ.',
    dlGroupClients: 'ДЛЯ КЛИЕНТОВ НА ЭТОМ УСТРОЙСТВЕ',
    dlGroupRouter: 'ДЛЯ РОУТЕРА',
    // Не «сама подписка»: в группе лежат ключи AmneziaVPN, а их как раз
    // переносят на соседнее устройство, и заголовок должен называть повод.
    dlGroupOther: 'ДЛЯ ДРУГОГО УСТРОЙСТВА',
    dlDead: 'Пока подписка не действует, конфиги не выдаются: по этим адресам приходит тот же отказ, что привёл вас на эту страницу. Всё вернётся сразу после продления, ссылка та же.',
    dlGet: 'Скачать',
    tgOpen: 'Открыть в Telegram',
    tgHttpFields: { server: 'Сервер', port: 'Порт', login: 'Логин', password: 'Пароль', copyPassword: 'Пароль' },
    outlineOpen: 'Открыть в Outline',
    dlCopyKey: 'Ключ',
    dlCopy: 'Конфиг',
    stepGet: 'Скачать',
    stepAdd: 'Добавить в',
    dlHint:
      'Точкой отмечено то, что подходит выбранной платформе. Остальное оставлено нарочно: конфиг чаще забирают для другого устройства, чем для этого.',
    noServersTitle: 'Серверов пока нет. ',
    noServers:
      'Этой подписке не выдано ни одного сервера, поэтому называть приложение и выдавать конфиг пока нечем. Всё появится здесь сразу, как оператор выдаст доступ, и ссылка останется той же: брать её заново не нужно.',
    formatNames: {
      clash: 'Clash-совместимые',
      singbox: 'sing-box',
      xrayjson: 'Xray JSON',
      'xrayjson-array': 'Xray JSON, массивом',
      outline: 'Outline',
      surge: 'Surge',
      quantumultx: 'Quantumult X',
      loon: 'Loon',
      json: 'Список точек входа',
      xkeen: 'XKeen на Keenetic',
      wgconf: 'wg-quick / awg',
      amneziavpn: 'Ключ AmneziaVPN',
      plain: 'Ссылка подписки',
      mtproto: 'Прокси для Telegram',
      'tg-socks': 'Telegram, SOCKS5',
      'tg-http': 'Telegram, HTTP',
    },
    formats: {
      clash: 'Clash Verge, FlClash, Clash Mi. Вся подписка одним файлом',
      singbox: 'sing-box, Karing, Hiddify. Вся подписка одним файлом',
      xrayjson: 'v2rayN, Throne, Happ. Вся подписка одним файлом',
      'xrayjson-array': 'Те же серверы отдельными конфигами, именно так их читают Happ и v2RayTun',
      outline: 'Ключ доступа Outline: вставить в «Добавить сервер» или открыть. Shadowsocks, только этот сервер',
      surge: 'iOS и macOS. Приложение платное',
      quantumultx: 'iOS. Приложение платное',
      loon: 'iOS. Приложение платное',
      json: 'Собственный список точек входа панели, для инструментов',
      xkeen: 'Keenetic с XKeen: исходящие и маршрутизация, без входящего',
      wgconf: 'Один туннель на один сервер, а не вся подписка',
      amneziavpn: 'Скопировать и вставить в приложение, оно разберёт само. Один туннель на один сервер',
      plain: 'Сама подписка, base64. Именно это забирает клиент по ссылке',
      mtproto: 'Только внутри Telegram, остальной трафик через него не идёт. Ни в один файл конфига он не попадает',
      'tg-socks': 'Открывает в Telegram окно добавления прокси, внутри ваш логин. Только этот сервер',
      'tg-http': 'Только Telegram Desktop: Настройки, Продвинутые настройки, Тип соединения, HTTP-прокси. Четыре поля вводятся руками',
    },
    transferTitle: 'Перенести на другое устройство',
    transferNote:
      'Наведите камеру телефона или планшета. Подписка откроется там же, ставить приложение на этом устройстве не нужно.',
    transferWarn: 'Кто получит этот код, получит и вашу подписку. Не выкладывайте его никуда.',
    close: 'Закрыть',
    noExpiry: 'без срока',
    unlimited: 'безлимит',
    protocols: 'Протоколы',
    subLink: 'Ссылка подписки',
    deadLinkNote:
      'Ссылка не меняется. Сохраните её: она заработает снова, как только заработает подписка.',
    copy: 'Копировать',
    copied: 'Скопировано',
    copyKey: 'Скопировать ключ',
    qrNeedsJs: 'QR рисуется в браузере: включите JavaScript или скопируйте текст выше.',
    setup: 'Установка',
    scanTitle: 'Ключи AmneziaWG',
    oneTunnel: 'Один ключ это один туннель до одного сервера, а не вся подписка.',
    oneTunnelMany: 'Один ключ это один туннель до ОДНОГО сервера, а не вся подписка. Сначала выберите сервер, потом сканируйте: если импортировать все, получится по отдельному подключению на каждый, а не набор с переключением.',
    support: 'Поддержка',
    routerLabel: 'Роутер',
    statusValues: {
      active: 'активна',
      revoked: 'отозвана',
      disabled: 'отключена',
      expired: 'истекла',
      limited: 'лимит исчерпан',
    },
  },
};
