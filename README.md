<div align="center">
  <img src=".github/assets/iceslab-icon.svg" width="88" alt="Iceslab">
  <h1>Iceslab</h1>
  <p>Self-hosted proxy panel that runs every protocol on its own upstream core.</p>
  <p>
    <a href="#install"><img src="https://img.shields.io/badge/Get_started_%E2%86%92-7DD3FC?style=for-the-badge" alt="Get started"></a>
  </p>
  <p>
    <a href="https://github.com/icecompany-tech/iceslab/releases/latest"><img src="https://img.shields.io/github/v/release/icecompany-tech/iceslab?label=release" alt="Latest release"></a>
    <a href="https://github.com/icecompany-tech/iceslab/stargazers"><img src="https://img.shields.io/github/stars/icecompany-tech/iceslab?label=stars" alt="GitHub stars"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
    <img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: alpha">
  </p>
  <p>English · <a href="./README.ru.md">Русский</a></p>
  <a href="docs/image/dashboard.png"><img src="docs/image/dashboard.png" width="900" alt="Iceslab operator dashboard: fleet, traffic, users and live host telemetry"></a>
</div>

<br>

Self-hosted proxy management panel that runs the real upstream binary for each protocol instead of wrapping everything through Xray-core. Hysteria 2, Xray (VLESS / VMess / Trojan + REALITY), AmneziaWG kernel module, NaiveProxy (Caddy fork), Shadowsocks 2022, MTProto, Mieru, and a sing-box engine for TUIC / AnyTLS / ShadowTLS: each one is the actual project binary, managed by a Go node-agent under a unified `CoreAdapter` interface.

## Why Iceslab

- 7 protocols on their own upstream binaries, plus a sing-box engine that adds TUIC, AnyTLS and ShadowTLS - no lowest-common-denominator reimplementation.
- Push over mTLS - the panel pushes config to agents, they apply and report back. No SSH into nodes.
- Built for hostile networks - REALITY self-steal, multi-hop cascades, DPI-aware setup recipes, routing presets.
- One subscription URL per user - disable, revoke, or cap traffic without touching the protocol layer. Every client format from one link (clash, sing-box, xray-json, wireguard, base64).
- Operator-grade - live fleet telemetry, per-user HWID limits and quotas, analytics, Telegram bot, admin 2FA.
- Self-hosted, AGPL-3.0 - your nodes, your data. One-command install via Docker Compose.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/image/node-cards.png" alt="Node fleet"><br><sub>Multi-node fleet with live CPU / RAM / disk, pushed over mTLS.</sub></td>
    <td width="50%"><img src="docs/image/profiles-settings.png" alt="Protocol profiles"><br><sub>Guided, DPI-aware protocol setup. Manual edits always available.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/image/users.png" alt="Users"><br><sub>One subscription URL per user. Disable, revoke or cap traffic without touching the protocol layer.</sub></td>
    <td width="50%"><img src="docs/image/cascade.png" alt="Cascades"><br><sub>Multi-hop cascades: chain nodes entry to exit for layered routing.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/image/squads.png" alt="Squads"><br><sub>Squads are access slices: which inbounds each user sees in their subscription.</sub></td>
    <td width="50%"><img src="docs/image/login.png" alt="Iceslab operator console"><br><sub>One panel. Every protocol. Native cores. mTLS agents.</sub></td>
  </tr>
</table>

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

In the panel: Nodes → Create node, fill in the name and the address, pick the cores the node gets, submit. The panel shows the install command with a one-time bootstrap token (valid 15 minutes; Refresh bootstrap on the node row mints a new one). Run it on the node VPS as root, as it is:

```bash
sudo -i
bash <(curl -fsSL .../install-iceslab-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --engines xray,hysteria \
  --panel-ip 203.0.113.10 \
  --hysteria-domain hy2-01.example.com
```

The panel fills in the installer's address and version: the agent it installs matches the panel. Each core is installed by its own bootstrap and starts idle; its settings (keys, domain, masquerade, ports) come from the panel's profiles on the first push, so the install takes no per-protocol settings. Cores can also be added later from the node page.

Installer flags, for reading or adjusting the command:

| Flag | Effect |
|---|---|
| `--panel-url <url>` | The panel the agent belongs to. `https://` only. |
| `--bootstrap <token>` | The one-time token from the panel. `--bootstrap-file <path>` reads it from a file instead, so it never shows in the process list. |
| `--engines <list>` | The cores, comma-separated, in any order: `xray`, `singbox`, `hysteria`, `amneziawg`, `mtproto`, `mieru`, `naive`. None: the agent alone. |
| `--panel-ip <ip>[,<ip>]` | Only these addresses may reach the agent's port (ufw). |
| `--port <n>` | The agent's mTLS port, default `1337`. |
| `--hysteria-domain <name>` | The name Hysteria's certificate is issued for (ACME, HTTP-01). The panel sets it from the node's address when that is a name. |
| `--hysteria-email <address>` | Optional: the contact of the ACME account. The certificate is issued without it; an `example.*` or `localhost` address is refused, as Let's Encrypt refuses it. |
| `--hysteria-port-range <a-b>` | Port hopping range, default `20000-50000`; `""` turns it off. |
| `--harden-ufw` | Rate-limit SSH and tighten the firewall. |
| `--fail2ban` | Install fail2ban with an sshd jail. |
| `--ssh-allowlist <csv>` | Allow 22/tcp only from these IPs or CIDRs. |
| `--realistic-fallback` | A real-looking fallback for probes. |
| `--reset` | Wipe a previous install on this VPS first. |
| `--uninstall` | Remove the agent and its cores (`--keep-cores` leaves the cores). |

Commands printed by older panels keep working: the installer still accepts their spellings (`--protocol`, `--with-singbox`, `--xray-reality-*`).

Per core:

- **Hysteria 2**: an A-record for the node's name, DNS only (UDP does not pass through Cloudflare). The agent writes `/etc/hysteria/config.yaml` and obtains the certificate on the panel's first push; a node on an IP gets the panel's self-signed one.
- **NaiveProxy**: an A-record for the profile's `hostname`. Building it needs 2 GB RAM.
- **AmneziaWG**: the amnezia DKMS kernel module plus `awg` / `awg-quick`. The default subnet is `10.66.66.0/24`, since `10.0.0.0/24` collides with the host gateway on some budget providers. Pick a port below 9999: RU mobile carriers DPI-drop outbound UDP/443, and 51820 is targeted as the WireGuard default. Clients: AmneziaVPN ≥ 4.8.12.9 or Hiddify Next ≥ 2.4; non-zero S3/S4 drop traffic in AmneziaVPN ([amnezia-client#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582)), so presets keep `S3=0 S4=0`.
- **Xray (REALITY), Shadowsocks 2022 (on Xray), MTProto, Mieru**: no public domain needed; MTProto picks its masquerade domain in the profile.

A note on `node.address`: this is the mTLS endpoint the panel uses to reach the agent (port 1337 by default). For routed-style cores (Hysteria, Naive, MTProto) it's the same FQDN clients hit on :443; for IP-style cores (Xray REALITY, AmneziaWG) it's the bare VPS IP. Set it correctly when creating the node: changing it later means using Refresh bootstrap (key icon on the node row) to re-issue the agent cert with the matching SAN.

### Running multiple protocols on one node

One node-agent can host several protocols at once. The model is: a Profile carries one protocol + its config; a Binding deploys that profile onto a node at a specific port. To run, say, Xray + Hysteria + Shadowsocks on the same VPS:

1. Install the node-agent once, with the cores in `--engines` (or none, and add them later from the node page).
2. Create one Profile per protocol in the panel (Profiles → Create).
3. In Nodes → edit the node, deploy each profile as a binding. Each binding gets its own listen port; the quick-deploy chips auto-pick the first free port from `[443, 8443, 2053, 2083, 2087, 2096]`, or you can type one inline.

Two bindings can't share a port (unique `(node, port)` constraint), and none of them may reuse the node-agent's own mTLS port (1337 by default). The UI flags a port collision before you save. There's no "one socket, N protocols" multiplexing: each protocol listens on its own port.

### Installer knobs

Both installers read env overrides. The ones people reach for most:

| Env | Default | Effect |
|---|---|---|
| `ICESLAB_REF` / `ICESLAB_NODE_REF` | `v0.2.1` | Git tag/branch/sha to install. Pin to a release tag for reproducibility. |
| `SKIP_SWAP` | `0` | Set `1` to skip the auto 4 GB swapfile on small-RAM VPS. The build may OOM on <3.5 GB RAM without swap; only opt out if you manage swap yourself. |
| `NODE_PORT` | `1337` | node-agent mTLS listen port. Change per-node to dodge port scanners. |
| `FRONTEND_PORT` | `8080` | Panel SPA port in bare-IP mode (ignored when `PANEL_DOMAIN` is set, Caddy fronts 443). |
| `FRONTEND_BIND` | `127.0.0.1` behind a domain, `0.0.0.0` in bare-IP mode | Host address that port is published on. A docker-published port is DNAT'd before the firewall's filter rules, so `ufw` cannot close it: this is the only control. Leave it on loopback whenever a reverse proxy sits in front. |

## Operating the panel

Once installed, drive the host from a single entry point on the panel box:

```bash
cd /opt/iceslab
bash scripts/iceslab.sh
```

It opens a menu that explains each action (deploy, backend/frontend-only deploy, logs, cleanup, backup, restore) and runs the one you pick. Deploys auto-apply DB migrations. For scripting, run an action directly: `bash scripts/iceslab.sh deploy`. The individual scripts live in `scripts/ops/`; `iceslab.sh` only explains and routes to them.

## Protocols

| Protocol | What runs on the node | Native or Xray |
|---|---|---|
| Hysteria 2 | `hysteria server` from apernet/hysteria, with auth-callback, Brutal CC, Salamander obfs, port-hopping | native |
| Xray | `xray run` with VLESS / VMess / Trojan; security REALITY, own-cert TLS or none; transports raw / ws / gRPC / xhttp / httpupgrade / kcp; Vision flow | native |
| AmneziaWG | amnezia-vpn DKMS kernel module + `awg-quick` | native |
| NaiveProxy | Caddy fork (`klzgrad/forwardproxy@naive` via xcaddy) | native |
| Shadowsocks 2022 | xray-core inbound with `2022-blake3-*` ciphers | reuses xray binary |
| MTProto | `9seconds/mtg` Fake-TLS, per-inbound secret derived from (id, domain) | native |
| Mieru | `enfein/mieru` (`mita apply config` + reload) | native |
| TUIC / AnyTLS / ShadowTLS | `sing-box` server, installed with `--with-singbox` | sing-box engine |

### Engine choice

Most protocols are rendered by one core, but VLESS, VMess, Trojan, Shadowsocks and
Hysteria 2 can be served by either xray or sing-box. The profile carries an `engine`
field: leave it unset and the protocol's native core handles it, set it to `singbox`
and the same profile is rendered by sing-box instead.

The engine has to be on the node before a profile can pick it: name it in
`--engines` beside the native core (pick both cores when creating the node), or
add it later from the node page.

```bash
bash <(curl -fsSL .../install-iceslab-node.sh) --panel-url ... --bootstrap ... --engines xray,singbox
```

**TUIC, AnyTLS and ShadowTLS** are served only by this engine, and a profile for
them carries no `engine` of its own: leaving it unset resolves to sing-box, and
setting `singbox` explicitly is accepted too. ShadowTLS has no share-link form,
it reaches clients through the full-config subscription formats (sing-box,
clash), not through a `://` URI.

**Field status.** The sing-box engine is green in code and unit tests but not yet
confirmed on a live line, and neither is WARP egress below. This project marks a
protocol as done when it carries real traffic through a real network, not when it
compiles.

### WARP egress

A node can send its traffic out through Cloudflare WARP instead of its own IP: the
panel registers a WARP device for the node and renders a wireguard outbound on the
node's xray config. Per-node toggle, no client-side change. Useful where the node's
own address is what services block.

## Subscriptions

One link per user: `https://panel.example.com/sub/<token>`. The same URL serves every client:

| Format | Trigger | Typical clients |
|---|---|---|
| base64 URI list (`plain`) | default | v2rayN, Streisand, anything |
| `clash` | `?format=clash` or User-Agent match | Clash Meta / mihomo apps |
| `singbox` | `?format=singbox` or UA | sing-box, Hiddify |
| `xrayjson` | `?format=xrayjson` or UA | Xray-JSON importers |
| `json` | `?format=json` | API integrations |
| `wgconf` | `?format=wgconf` | AmneziaWG / wg-quick `.conf` |
| HTML page | browser | landing page with QR + per-format links |

User-Agent auto-detection is admin-editable (Subscription Response Rules page). Useful query params: `?topN=N` caps the list to the best nodes by region + load, `?bundle=url-test|balancer` picks the auto-failover flavor, `?routing=` overrides the routing preset per request.

Panel-wide routing preset (Subscription page): `proxy-all` (default, everything tunnels) or `ru-split` (ads blocked, RU domains/IPs and private ranges direct, the rest tunnels). Applies to the full-config formats: clash, singbox, xrayjson. Per-user device limits (HWID) are enforced on the same endpoint.

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

- **Contributing**: see [CONTRIBUTING.md](./CONTRIBUTING.md). PRs accepted under AGPL-3.0 inbound = outbound; commits squashed on merge.
- **Security**: vulnerabilities to `security@icecompany.tech`. Details + disclosure timeline in [SECURITY.md](./SECURITY.md).
- **Privacy**: what the panel and the nodes keep about the people you serve, for how long, and what earlier versions left behind, in [PRIVACY.md](./PRIVACY.md). Iceslab sends none of it to us.
- **Trademark**: the name "Iceslab" is restricted; full policy in [TRADEMARK.md](./TRADEMARK.md). AGPL rights to the code are unaffected: fork freely, just rename if you ship publicly.

## Support the project

Iceslab is built by one person and stays AGPL. If it saves you time, a
donation keeps the test nodes running:

- **USDT (TRC-20):** `TM432rBBe3Eo5REkWn81ajJ9JLjGuuTjEJ`

Check the network before sending: TRC-20 only, other networks are lost.

## License

Copyright (C) 2026 Icecompany. Released under [AGPL-3.0-or-later](./LICENSE). If you run a modified Iceslab as a service, you have to offer the source to your users.
