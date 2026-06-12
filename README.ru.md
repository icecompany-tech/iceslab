# Iceslab

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#)
[![GitHub stars](https://img.shields.io/github/stars/icecompany-tech/iceslab?style=social)](https://github.com/icecompany-tech/iceslab)

[English](./README.md) · Русский

Self-hosted панель для прокси, которая запускает настоящий апстрим-бинарник каждого протокола вместо того чтобы оборачивать всё через Xray-core. Hysteria 2, Xray (VLESS / VMess / Trojan + REALITY), AmneziaWG kernel module, NaiveProxy (Caddy fork), Shadowsocks 2022, MTProto, Mieru: каждый это реальный бинарь проекта, под управлением Go node-agent через общий интерфейс `CoreAdapter`.

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

В панели: Nodes → Create node → имя + адрес → submit. Модалка покажет одноразовую bootstrap-команду с 15-минутным токеном. Запусти её на VPS ноды с флагами протокола ниже.

#### Xray

REALITY использует SNI-spoofing, домен не нужен. Сначала создай inbound в панели (Inbounds → Create, Generate для keypair), потом на ноде:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol xray \
  --xray-reality-private-key sI_p9bg-7cy... \
  --xray-reality-short-ids   abc123 \
  --xray-reality-server-names www.cloudflare.com \
  --xray-reality-dest        www.cloudflare.com:443
```

#### Hysteria 2

A-запись `hy2-01.example.com` → IP VPS (DNS only; UDP/443 через Cloudflare всё равно не пройдёт).

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

Скрипт пишет `/etc/hysteria/config.yaml`, кладёт systemd-юнит, и при первом запуске Hysteria получит LE-сертификат через HTTP-01.

#### AmneziaWG

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol amneziawg
```

Ставит amnezia-vpn DKMS kernel-модуль + `awg` / `awg-quick`. Открывает UDP 443 и 1234 в ufw, флипает `DEFAULT_FORWARD_POLICY=ACCEPT`, включает `ip_forward`.

Пара вещей которые ловят людей врасплох:

- Default подсеть `10.66.66.0/24`. Очевидная `10.0.0.0/24` коллизит с внутренним host-gateway у некоторых бюджетных VPS-провайдеров.
- Порт меньше 9999. RU мобильные ISP DPI-дропают исходящий UDP/443, а 51820 это default WireGuard который таргетят специально. 1234 или 51280 нормально.
- Клиент: AmneziaVPN ≥ 4.8.12.9 или Hiddify Next ≥ 2.4. Есть upstream-баг ([amnezia-client#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582)) когда ненулевые S3/S4 молча дропают трафик, поэтому пресеты по умолчанию `S3=0 S4=0`.

#### NaiveProxy / Shadowsocks 2022 / MTProto / Mieru

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol naive
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol shadowsocks
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol mtproto
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol mieru
```

Bootstrap ставит апстрим-бинарь: xcaddy fork для Naive (нужно 2 GB RAM), xray-core для SS2022, `9seconds/mtg` для MTProto, `enfein/mieru` для Mieru.

Эти протоколы не принимают флагов домена или cert при установке. Стартуют idle и ждут пока панель пушнёт inbound config через `applyInbounds`. Domain, email, masquerade и прочие protocol-specific поля живут в panel-side Profile (задаётся в UI один раз) и потом распространяются на все ноды куда профиль задеплоен. Naive требует A-запись (`hostname` в профиле); MTProto выбирает masquerade-домен там же; SS2022 и Mieru не требуют публичного домена.

Про `node.address`: это mTLS-эндпоинт, через который панель ходит на агента (порт 1337 по умолчанию начиная с v0.1.2; 8443 на pre-v0.1.2 установках). Для routed-style ядер (Hysteria, Naive, MTProto) это тот же FQDN на котором клиенты будут стучаться в :443; для IP-style (Xray REALITY, AmneziaWG) это голый IP. Задавай правильно при создании ноды, потому что менять потом можно только через Refresh bootstrap (key-иконка в строке ноды) с перевыпуском cert под новый SAN.

### Несколько протоколов на одной ноде

Один node-agent может держать сразу несколько протоколов. Модель: Profile несёт один протокол + его конфиг; Binding деплоит профиль на ноду на конкретный порт. Чтобы поднять, например, Xray + Hysteria + Shadowsocks на одном VPS:

1. Поставь node-agent один раз (с любым одним `--protocol`, или без него: агент просто бутстрапит себя + те бинарники, что попросишь).
2. Создай по одному Profile на каждый протокол (Profiles → Create).
3. В Nodes → редактирование ноды задеплой каждый профиль как binding. Каждый binding получает свой listen-порт; чипы quick-deploy сами берут первый свободный из `[443, 8443, 2053, 2083, 2087, 2096]`, либо впиши вручную.

Два binding не могут делить порт (уникальный индекс `(node, port)`), и ни один не должен совпадать с mTLS-портом самого node-agent (по умолчанию 1337). UI подсветит конфликт до сохранения. Мультиплексирования "один сокет, N протоколов" нет: каждый протокол слушает свой порт.

### Параметры установщика

Оба установщика читают env-переопределения. Самые ходовые:

| Env | По умолчанию | Эффект |
|---|---|---|
| `ICESLAB_REF` / `ICESLAB_NODE_REF` | `v0.1.6` | Git-тег/ветка/sha для установки. Пинь на тег релиза для воспроизводимости. |
| `SKIP_SWAP` | `0` | Поставь `1` чтобы пропустить авто-создание swapfile 4 ГБ на VPS с малым RAM. На <3.5 ГБ RAM без swap сборка может словить OOM; отключай только если управляешь swap сам. |
| `NODE_PORT` | `1337` | mTLS listen-порт node-agent. Меняй per-node чтобы уходить от сканеров портов. |
| `FRONTEND_PORT` | `8080` | Порт SPA панели в bare-IP режиме (игнорируется когда задан `PANEL_DOMAIN`, тогда Caddy на 443). |

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
- **Безопасность**: уязвимости на `learntoowork@outlook.com`. Детали и таймлайн раскрытия в [SECURITY.md](./SECURITY.md).
- **Торговая марка**: имя "Iceslab" ограничено к использованию, политика в [TRADEMARK.md](./TRADEMARK.md). AGPL-права на код не затрагивает, форкай свободно, просто переименуй если шипишь публично.

## Лицензия

Copyright (C) 2026 Icecompany. Распространяется под [AGPL-3.0-or-later](./LICENSE). Если запускаешь модифицированный Iceslab как сервис, обязан предоставить исходники своим пользователям.
