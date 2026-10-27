<div align="center">
  <img src=".github/assets/iceslab-icon.svg" width="88" alt="Iceslab">
  <h1>Iceslab</h1>
  <p>Self-hosted панель для прокси, где каждый протокол работает на своём настоящем ядре.</p>
  <p>
    <a href="#установка"><img src="https://img.shields.io/badge/%D0%9D%D0%B0%D1%87%D0%B0%D1%82%D1%8C_%E2%86%92-7DD3FC?style=for-the-badge" alt="Начать"></a>
  </p>
  <p>
    <a href="https://github.com/icecompany-tech/iceslab/releases/latest"><img src="https://img.shields.io/github/v/release/icecompany-tech/iceslab?label=release" alt="Последний релиз"></a>
    <a href="https://github.com/icecompany-tech/iceslab/stargazers"><img src="https://img.shields.io/github/stars/icecompany-tech/iceslab?label=stars" alt="Звёзды на GitHub"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="Лицензия: AGPL-3.0"></a>
    <img src="https://img.shields.io/badge/status-alpha-orange" alt="Статус: alpha">
  </p>
  <p><a href="./README.md">English</a> · Русский</p>
  <a href="docs/image/dashboard.png"><img src="docs/image/dashboard.png" width="900" alt="Панель оператора Iceslab: флот, трафик, пользователи и живая телеметрия хоста"></a>
</div>

<br>

Self-hosted панель для прокси, которая запускает настоящий апстрим-бинарник каждого протокола вместо того чтобы оборачивать всё через Xray-core. Hysteria 2, Xray (VLESS / VMess / Trojan + REALITY), AmneziaWG kernel module, NaiveProxy (Caddy fork), Shadowsocks 2022, MTProto, Mieru и движок sing-box для TUIC / AnyTLS / ShadowTLS: каждый это реальный бинарь проекта, под управлением Go node-agent через общий интерфейс `CoreAdapter`.

## Зачем Iceslab

- 7 протоколов на своих апстрим-бинарниках плюс движок sing-box, добавляющий TUIC, AnyTLS и ShadowTLS - без реализации по принципу наименьшего общего знаменателя.
- Пуш по mTLS - панель отправляет конфиг агентам, они применяют и отчитываются. Никакого SSH на ноды.
- Сделано для враждебных сетей - REALITY self-steal, многохоповые каскады, DPI-aware рецепты настройки, пресеты маршрутизации.
- Одна ссылка-подписка на пользователя - отключение, лимит или отзыв без вмешательства в слой протокола. Любой формат клиента из одной ссылки (clash, sing-box, xray-json, wireguard, base64).
- Операторский уровень - живая телеметрия флота, HWID-лимиты и квоты на пользователя, аналитика, Telegram-бот, 2FA для админа.
- Self-hosted, AGPL-3.0 - твои ноды, твои данные. Установка одной командой через Docker Compose.

## Скриншоты

<table>
  <tr>
    <td width="50%"><img src="docs/image/node-cards.png" alt="Флот нод"><br><sub>Мульти-нода флот с живыми CPU / RAM / диск, доставка по mTLS.</sub></td>
    <td width="50%"><img src="docs/image/profiles-settings.png" alt="Профили протоколов"><br><sub>Управляемая настройка протоколов с учётом DPI. Ручная правка всегда доступна.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/image/users.png" alt="Пользователи"><br><sub>Одна ссылка-подписка на пользователя. Отключение, лимит или отзыв без вмешательства в слой протокола.</sub></td>
    <td width="50%"><img src="docs/image/cascade.png" alt="Каскады"><br><sub>Многохоповые каскады: цепочка нод от входа к выходу для слоистой маршрутизации.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/image/squads.png" alt="Сквады"><br><sub>Сквады это срезы доступа: какие инбаунды видит пользователь в своей подписке.</sub></td>
    <td width="50%"><img src="docs/image/login.png" alt="Консоль оператора Iceslab"><br><sub>Одна панель. Все протоколы. Нативные ядра. mTLS-агенты.</sub></td>
  </tr>
</table>

## Установка

Ubuntu 22.04+ или Debian 12+, root, идемпотентно.

### Панель

Заведи A-запись на VPS (`panel.example.com`, DNS only / серое облако в Cloudflare). После пропагации:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab.sh)
```

Ставит Docker, билдит образы, поднимает Postgres + Redis + backend + frontend, ставит Caddy с auto-TLS, лочит ufw на 22/80/443. Первый запуск 5-10 минут.

Для быстрых локальных тестов без TLS:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab.sh)
```

SPA на `http://<vps-ip>:8080`. JWT летят открытым текстом, в продакшен так не выпускать.

### Нода

В панели: Nodes → Create node, имя и адрес, ядра для ноды, submit. Панель покажет команду установки с одноразовым bootstrap-токеном (живёт 15 минут; Refresh bootstrap в строке ноды выпускает новый). Запусти её на VPS ноды от root как есть:

```bash
sudo -i
bash <(curl -fsSL .../install-iceslab-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --engines xray,hysteria \
  --panel-ip 203.0.113.10 \
  --hysteria-domain hy2-01.example.com
```

Адрес и версию установщика панель подставляет сама: агент ставится той же версии, что панель. Каждое ядро ставит свой bootstrap, и оно стартует пустым; настройки (ключи, домен, маскировка, порты) приходят из профилей панели при первом пуше, поэтому при установке настройки протоколов не нужны. Ядра можно добавить и позже, со страницы ноды.

Флаги, которые подставляет панель, чтобы прочитать или поправить команду:

| Флаг | Что делает |
|---|---|
| `--panel-url <url>` | Панель, к которой относится агент. Только `https://`. |
| `--bootstrap <token>` | Одноразовый токен из панели. `--bootstrap-file <path>` читает его из файла, тогда он не виден в списке процессов. |
| `--engines <список>` | Ядра через запятую, в любом порядке: `xray`, `singbox`, `hysteria`, `amneziawg`, `mtproto`, `mieru`, `naive`. Пусто: только агент. |
| `--panel-ip <ip>[,<ip>]` | Порт агента доступен только с этих адресов (ufw). |
| `--port <n>` | mTLS-порт агента, по умолчанию `1337`. |
| `--hysteria-domain <имя>` | Имя, на которое Hysteria получает сертификат (ACME, HTTP-01). Панель берёт его из адреса ноды, если это имя. |
| `--hysteria-email <адрес>` | Необязательно: контакт ACME-аккаунта. Сертификат выпускается и без него; адрес на `example.*` или `localhost` установщик отвергает, как отвергает его Let's Encrypt. |
| `--hysteria-port-range <a-b>` | Диапазон port hopping, по умолчанию `20000-50000`; `""` выключает. |
| `--harden-ufw` | Ограничение частоты SSH и более строгий firewall. |
| `--fail2ban` | fail2ban с клетками для sshd и входа Hysteria. |
| `--ssh-allowlist <csv>` | 22/tcp только с этих IP или CIDR. |
| `--realistic-fallback` | Правдоподобный ответ на пробы. |
| `--reset` | Сначала снести прежнюю установку на этом VPS. |
| `--uninstall` | Удалить агента и его ядра (`--keep-cores` оставляет ядра). |

Установщик принимает и ещё несколько, которых в команде панели нет: `--payload` и `--payload-file <path>` (payload ноды вместо bootstrap-токена, например файл, скопированный через scp), `--hysteria-masquerade-url`, `--hysteria-obfs-password`, `--xray-port`, `--xray-reality-public-key`. Команды, которые печатали старые панели, продолжают работать: установщик принимает их написание (`--protocol`, `--with-singbox`, `--xray-reality-*`).

По ядрам:

- **Hysteria 2**: A-запись на имя ноды, только DNS (UDP через Cloudflare не проходит). Агент пишет `/etc/hysteria/config.yaml` и получает сертификат при первом пуше панели; нода на IP получает самоподписанный от панели.
- **NaiveProxy**: A-запись на `hostname` профиля. Сборке нужно 2 GB RAM.
- **AmneziaWG**: DKMS-модуль ядра amnezia и `awg` / `awg-quick`. Подсеть по умолчанию `10.66.66.0/24`, потому что `10.0.0.0/24` совпадает с host-gateway у некоторых бюджетных провайдеров. Порт ниже 9999: мобильные операторы в РФ режут исходящий UDP/443 по DPI, а 51820 как порт WireGuard по умолчанию ловят специально. Клиенты: AmneziaVPN ≥ 4.8.12.9 или Hiddify Next ≥ 2.4; ненулевые S3/S4 в AmneziaVPN рвут трафик ([amnezia-client#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582)), поэтому пресеты держат `S3=0 S4=0`.
- **Xray (REALITY), Shadowsocks 2022 (на Xray), MTProto, Mieru**: публичный домен не нужен; домен маскировки MTProto выбирается в профиле.

Про `node.address`: это mTLS-эндпоинт, через который панель ходит на агента (порт 1337 по умолчанию). Для routed-style ядер (Hysteria, Naive, MTProto) это тот же FQDN на котором клиенты будут стучаться в :443; для IP-style (Xray REALITY, AmneziaWG) это голый IP. Задавай правильно при создании ноды, потому что менять потом можно только через Refresh bootstrap (key-иконка в строке ноды) с перевыпуском cert под новый SAN.

### Несколько протоколов на одной ноде

Один node-agent может держать сразу несколько протоколов. Модель: Profile несёт один протокол + его конфиг; Binding деплоит профиль на ноду на конкретный порт. Чтобы поднять, например, Xray + Hysteria + Shadowsocks на одном VPS:

1. Поставь node-agent один раз, с ядрами в `--engines` (или без них, и добавь их позже со страницы ноды).
2. Создай по одному Profile на каждый протокол (Profiles → Create).
3. В Nodes → редактирование ноды задеплой каждый профиль как binding. Каждый binding получает свой listen-порт; чипы quick-deploy сами берут первый свободный из `[443, 8443, 2053, 2083, 2087, 2096]`, либо впиши вручную.

Два binding не могут делить порт (уникальный индекс `(node, port)`), и ни один не должен совпадать с mTLS-портом самого node-agent (по умолчанию 1337). UI подсветит конфликт до сохранения. Мультиплексирования "один сокет, N протоколов" нет: каждый протокол слушает свой порт.

### Параметры установщика

Оба установщика читают env-переопределения. Самые ходовые:

| Env | По умолчанию | Эффект |
|---|---|---|
| `ICESLAB_REF` / `ICESLAB_NODE_REF` | `v0.2.1` | Git-тег/ветка/sha для установки. Пинь на тег релиза для воспроизводимости. |
| `SKIP_SWAP` | `0` | Поставь `1` чтобы пропустить авто-создание swapfile 4 ГБ на VPS с малым RAM. На <3.5 ГБ RAM без swap сборка может словить OOM; отключай только если управляешь swap сам. |
| `NODE_PORT` | `1337` | mTLS listen-порт node-agent. Меняй per-node чтобы уходить от сканеров портов. |
| `FRONTEND_PORT` | `8080` | Порт SPA панели в bare-IP режиме (игнорируется когда задан `PANEL_DOMAIN`, тогда Caddy на 443). |
| `FRONTEND_BIND` | `127.0.0.1` с доменом, `0.0.0.0` в bare-IP режиме | Адрес, на котором публикуется этот порт. Опубликованный докером порт проходит DNAT раньше фильтрующих правил, поэтому `ufw` его закрыть не может: это единственный рычаг. Держи петлю, если впереди стоит обратный прокси. |

## Управление панелью

После установки всё управление хостом - из одной точки на боксе панели:

```bash
cd /opt/iceslab
bash scripts/iceslab.sh
```

Откроется меню: оно объясняет каждое действие (деплой, деплой только бэка/фронта, логи, очистка, бэкап, восстановление) и запускает выбранное. Деплой сам применяет миграции БД. Для скриптов - прямой вызов: `bash scripts/iceslab.sh deploy`. Сами скрипты лежат в `scripts/ops/`, `iceslab.sh` лишь объясняет и маршрутизирует.

## Протоколы

| Протокол | Что запускается на ноде | Native или Xray |
|---|---|---|
| Hysteria 2 | `hysteria server` из apernet/hysteria, с auth-callback, Brutal CC, Salamander obfs, port-hopping | native |
| Xray | `xray run` с VLESS / VMess / Trojan; security REALITY, свой TLS-серт или none; транспорты raw / ws / gRPC / xhttp / httpupgrade / kcp; Vision flow | native |
| AmneziaWG | amnezia-vpn DKMS kernel-модуль + `awg-quick` | native |
| NaiveProxy | Caddy fork (`klzgrad/forwardproxy@naive` через xcaddy) | native |
| Shadowsocks 2022 | xray-core inbound с `2022-blake3-*` шифрами | reuses xray binary |
| MTProto | `9seconds/mtg` Fake-TLS, per-inbound secret из (id, domain) | native |
| Mieru | `enfein/mieru` (`mita apply config` + reload) | native |
| TUIC / AnyTLS / ShadowTLS | сервер `sing-box`, ставится флагом `--with-singbox` | движок sing-box |

### Выбор движка

Большинство протоколов рендерит одно ядро, но VLESS, VMess, Trojan, Shadowsocks и
Hysteria 2 умеет отдавать и xray, и sing-box. У профиля есть поле `engine`: не
задано - протокол обслуживает его родное ядро, задано `singbox` - тот же профиль
рендерит sing-box.

Движок должен стоять на ноде до того, как профиль его выберет: назови его в
`--engines` рядом с родным ядром (выбери оба ядра при создании ноды) или добавь
позже со страницы ноды.

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --engines xray,singbox
```

**TUIC, AnyTLS и ShadowTLS** обслуживает только этот движок, и своего `engine`
профиль для них не несёт: пустое значение резолвится в sing-box, явное `singbox`
тоже принимается. У ShadowTLS нет формы share-link: до клиента он доезжает
полными форматами подписки (sing-box, clash), а не ссылкой `://`.

**Статус в поле.** Движок sing-box зелёный в коде и юнит-тестах, но пока не
подтверждён на живой линии; то же касается WARP-egress ниже. Протокол здесь
считается готовым, когда он несёт настоящий трафик через настоящую сеть, а не
когда он собрался.

### WARP-egress

Нода может выпускать трафик через Cloudflare WARP вместо собственного IP: панель
регистрирует для ноды WARP-устройство и добавляет wireguard-outbound в её
xray-конфиг. Переключатель на ноду, клиент менять не нужно. Полезно там, где
блокируют именно адрес ноды.

## Подписки

Одна ссылка на юзера: `https://panel.example.com/sub/<token>`. Один URL обслуживает все клиенты:

| Формат | Триггер | Типичные клиенты |
|---|---|---|
| base64 URI-список (`plain`) | по умолчанию | v2rayN, Streisand, что угодно |
| `clash` | `?format=clash` или User-Agent | приложения на Clash Meta / mihomo |
| `singbox` | `?format=singbox` или UA | sing-box, Hiddify |
| `xrayjson` | `?format=xrayjson` или UA | импортёры Xray-JSON |
| `json` | `?format=json` | API-интеграции |
| `wgconf` | `?format=wgconf` | AmneziaWG / wg-quick `.conf` |
| HTML-страница | браузер | человекочитаемая страница с QR и ссылками |

Автоопределение по User-Agent редактируется админом (страница Subscription Response Rules). Полезные query-параметры: `?topN=N` режет список до лучших нод по региону и нагрузке, `?bundle=url-test|balancer` выбирает режим авто-failover, `?routing=` переопределяет пресет маршрутизации на один запрос.

Панельный пресет маршрутизации (страница Подписка): `proxy-all` (по умолчанию, всё через туннель) или `ru-split` (реклама в блок, RU-домены/IP и приватные диапазоны напрямую, остальное в туннель). Действует на форматы полного конфига: clash, singbox, xrayjson. Лимит устройств на юзера (HWID) применяется на этом же эндпоинте.

## Стек

| Слой | Инструменты |
|---|---|
| Panel API | TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod, Pino |
| Background jobs | Redis 7, BullMQ |
| Auth | JWT (jose), bcrypt, `@fastify/rate-limit` |
| Inter-service | REST поверх mTLS через `@peculiar/x509`, undici |
| Frontend | React 19, Vite 8, Mantine 8, TanStack Query 5, Zustand 5 |
| Node-agent | Go 1.22+, нативный `crypto/tls`, `slog` |
| Tests | Vitest (panel), Go testing (node) |
| Infra | Docker, Docker Compose |

## Разработка

Node 22+, pnpm 10+, Go 1.22+, Docker. Тестировалось на Ubuntu (WSL).

```bash
pnpm install
docker compose up -d postgres redis postgres-test
pnpm --filter @iceslab/panel-backend exec prisma migrate dev
pnpm --filter @iceslab/panel-backend dev     # backend на :3000
pnpm --filter @iceslab/panel-frontend dev    # SPA на :5173
```

Создай первого администратора через форму «Create first admin» в SPA.

```bash
pnpm --filter @iceslab/panel-backend test    # backend (нужен postgres-test на :5433)
cd apps/node && go test ./...                # node-agent
pnpm --filter @iceslab/panel-frontend exec tsc --noEmit
```

## Политики проекта

- **Контрибуция**: см. [CONTRIBUTING.md](./CONTRIBUTING.md). PR принимаются под AGPL-3.0 inbound = outbound, коммиты squash'ятся при merge.
- **Безопасность**: уязвимости на `security@icecompany.tech`. Детали и таймлайн раскрытия в [SECURITY.md](./SECURITY.md).
- **Приватность**: что панель и ноды хранят о ваших пользователях, сколько и что оставили старые версии, в [PRIVACY.md](./PRIVACY.md) (на английском). Iceslab ничего из этого нам не отправляет.
- **Торговая марка**: имя "Iceslab" ограничено к использованию, политика в [TRADEMARK.md](./TRADEMARK.md). AGPL-права на код не затрагивает, форкай свободно, просто переименуй если шипишь публично.

## Поддержать проект

Iceslab делает один человек, и он остаётся под AGPL. Если панель экономит вам
время, донат идёт на тестовые ноды:

- **USDT (TRC-20):** `TM432rBBe3Eo5REkWn81ajJ9JLjGuuTjEJ`

Проверьте сеть перед отправкой: только TRC-20, в других сетях средства пропадут.

## Лицензия

Copyright (C) 2026 Icecompany. Распространяется под [AGPL-3.0-or-later](./LICENSE). Если запускаешь модифицированный Iceslab как сервис, обязан предоставить исходники своим пользователям.
