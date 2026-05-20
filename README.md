# Iceslab

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#)
[![GitHub stars](https://img.shields.io/github/stars/icecompany-tech/iceslab?style=social)](https://github.com/icecompany-tech/iceslab)

English · [Русский](./README.ru.md)

Self-hosted proxy management panel that runs the real upstream binary for each protocol instead of wrapping everything through Xray-core. Hysteria 2, Xray (VLESS + REALITY + Vision), AmneziaWG kernel module, NaiveProxy (Caddy fork), Shadowsocks 2022, MTProto, Mieru — each one is the actual project binary, managed by a Go node-agent under a unified `CoreAdapter` interface.

## Install

Ubuntu 22.04+ or Debian 12+, root, idempotent.

### Panel

Point an A-record at the VPS (`panel.example.com`, DNS only / gray cloud on Cloudflare). After propagation:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab.sh)
```

Installs Docker, builds the panel images, brings up Postgres + Redis + backend + frontend, installs Caddy with auto-TLS, locks ufw to 22/80/443. First run takes 5-10 minutes.

For quick local testing without TLS:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab.sh)
```

The SPA comes up on `http://<vps-ip>:8080`. JWTs travel in cleartext, so don't expose this to the internet.

### Node

In the panel: Nodes → Create node → fill name + address → submit. The modal shows a one-time bootstrap command with a 15-minute token. Run it on the node VPS with the protocol flags below.

#### Xray

REALITY uses SNI spoofing, no domain needed. Create the inbound in the panel first (Inbounds → Create, Generate for the keypair), then on the node:

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

A-record `hy2-01.example.com` → VPS IP (DNS only; UDP/443 doesn't pass through Cloudflare anyway).

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

The script writes `/etc/hysteria/config.yaml`, drops a systemd unit, and the first run obtains the LE cert over HTTP-01.

#### AmneziaWG

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol amneziawg
```

Installs the amnezia-vpn DKMS kernel module plus `awg` / `awg-quick`. The installer opens UDP 443 and 1234 in ufw, flips `DEFAULT_FORWARD_POLICY=ACCEPT`, enables `ip_forward`.

A few things that catch people:

- Default subnet is `10.66.66.0/24`. The more obvious `10.0.0.0/24` collides with the internal gateway on some providers (Aeza in particular).
- Pick a port below 9999. RU mobile carriers DPI-drop outbound UDP/443, and 51820 is the WireGuard default that gets specifically targeted. 1234 or 51280 are fine.
- Client compatibility: AmneziaVPN ≥ 4.8.12.9 or Hiddify Next ≥ 2.4. There's an upstream bug ([amnezia-client#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582)) where non-zero S3/S4 silently drops traffic; presets default to `S3=0 S4=0`.

#### NaiveProxy / Shadowsocks 2022 / MTProto / Mieru

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol naive
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol shadowsocks
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol mtproto
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --protocol mieru
```

Bootstrap installs the upstream binary: xcaddy fork for Naive (needs 2 GB RAM), xray-core for SS2022, `9seconds/mtg` for MTProto, `enfein/mieru` for Mieru.

These protocols take no install-time flags for domain or cert. They start idle and wait for the panel to push their inbound config via `applyInbounds`. Domain, email, masquerade and other protocol-specific fields live on the panel-side Profile (set once via UI), then propagate to every node the profile is deployed to. Naive needs an A-record (set in the profile's `hostname` field); MTProto picks its masquerade domain in the profile; SS2022 and Mieru don't need a public domain.

A note on `node.address`: this is the mTLS endpoint the panel uses to reach the agent (port 1337 by default since v0.1.2; 8443 on pre-v0.1.2 installs). For routed-style cores (Hysteria, Naive, MTProto) it's the same FQDN clients hit on :443; for IP-style cores (Xray REALITY, AmneziaWG) it's the bare VPS IP. Set it correctly when creating the node — changing it later means using Refresh bootstrap (key icon on the node row) to re-issue the agent cert with the matching SAN.

## Protocols

| Protocol | What runs on the node | Native or Xray |
|---|---|---|
| Hysteria 2 | `hysteria server` from apernet/hysteria, with auth-callback, Brutal CC, Salamander obfs, port-hopping | native |
| Xray | `xray run` with VLESS + REALITY + Vision; transports raw / xhttp / ws / gRPC / httpupgrade / kcp; Trojan over REALITY | native |
| AmneziaWG | amnezia-vpn DKMS kernel module + `awg-quick` | native |
| NaiveProxy | Caddy fork (`klzgrad/forwardproxy@naive` via xcaddy) | native |
| Shadowsocks 2022 | xray-core inbound with `2022-blake3-*` ciphers | reuses xray binary |
| MTProto | `9seconds/mtg` Fake-TLS, per-inbound secret derived from (id, domain) | native |
| Mieru | `enfein/mieru` (`mita apply config` + reload) | native |

## Stack

| Layer | Tools |
|---|---|
| Panel API | TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod, Pino |
| Background jobs | Redis 7, BullMQ |
| Auth | JWT (jose), bcrypt, `@fastify/rate-limit` |
| Inter-service | REST over mTLS via `@peculiar/x509`, undici |
| Frontend | React 19, Vite 8, Mantine 8, TanStack Query 5, Zustand 5 |
| Node-agent | Go 1.22+, native `crypto/tls`, `slog` |
| Tests | Vitest (panel), Go testing (node) |
| Infra | Docker, Docker Compose |

## Develop

Node 22+, pnpm 10+, Go 1.22+, Docker. Tested on Ubuntu (WSL).

```bash
pnpm install
docker compose up -d postgres redis postgres-test
pnpm --filter @iceslab/panel-backend exec prisma migrate dev
pnpm --filter @iceslab/panel-backend dev     # backend on :3000
pnpm --filter @iceslab/panel-frontend dev    # SPA on :5173
```

Bootstrap the first admin from the SPA's "Create first admin" form.

```bash
pnpm --filter @iceslab/panel-backend test    # backend (needs postgres-test on :5433)
cd apps/node && go test ./...                # node-agent
pnpm --filter @iceslab/panel-frontend exec tsc --noEmit
```

## Project policies

- **Contributing** — see [CONTRIBUTING.md](./CONTRIBUTING.md). PRs accepted under AGPL-3.0 inbound = outbound; commits squashed on merge.
- **Security** — vulnerabilities to `learntoowork@outlook.com`. Details + disclosure timeline in [SECURITY.md](./SECURITY.md).
- **Trademark** — the name "Iceslab" is restricted; full policy in [TRADEMARK.md](./TRADEMARK.md). AGPL rights to the code are unaffected — fork freely, just rename if you ship publicly.

## License

Copyright (C) 2026 Icecompany. Released under [AGPL-3.0-or-later](./LICENSE). If you run a modified Iceslab as a service, you have to offer the source to your users.
