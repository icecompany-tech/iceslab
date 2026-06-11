# Iceslab Node Agent

Single static Go binary that runs on each VPS hosting proxy cores.

## Configuration

The agent reads the following environment variables.

### Core (required)

| Var | Default | Description |
|---|---|---|
| `NODE_PAYLOAD` | required | Base64url-encoded JSON blob issued by the panel on `POST /api/nodes`. Contains the agent's mTLS cert + key and the panel CA. |
| `NODE_HOST` | `0.0.0.0` | Listen address for the panel-facing mTLS HTTPS server. |
| `NODE_PORT` | `1337` | Listen port for the mTLS HTTPS server. |

### Hysteria

| Var | Default | Description |
|---|---|---|
| `HYSTERIA_BINARY` | (none) | Path to `hysteria` executable. Empty means callback-only mode (no subprocess; Hysteria runs as a separate systemd unit). |
| `HYSTERIA_CONFIG` | (none) | Path to Hysteria YAML config. Used in subprocess mode and also when the server runs as a separate systemd unit (`ApplyInbound` rewrites this file). |
| `HYSTERIA_AUTH_HOST` | `127.0.0.1` | Bind host for the local `/auth` callback that Hysteria's `auth.type: http` calls. |
| `HYSTERIA_AUTH_PORT` | `9000` | Bind port for the local `/auth` callback. |
| `HYSTERIA_HOSTNAME` | (none) | Public FQDN used for ACME (Let's Encrypt http-01) cert issuance. Required for `ApplyInbound` to render `config.yaml`. |
| `HYSTERIA_ACME_EMAIL` | (none) | Contact address Let's Encrypt uses for renewal warnings. Required for `ApplyInbound` to render. |
| `HYSTERIA_LISTEN_PORT` | `443` | Public UDP port hysteria listens on. |
| `HYSTERIA_SERVICE_UNIT` | (none) | systemd unit to `systemctl restart` after `ApplyInbound` rewrites the config (e.g. `hysteria-server.service`). Empty means write file but skip restart. |

### Xray

The Xray adapter registers only when `XRAY_REALITY_PRIVATE_KEY` is set. Without the private key the inbound config would be invalid, so the adapter is skipped cleanly on single-protocol nodes.

| Var | Default | Description |
|---|---|---|
| `XRAY_REALITY_PRIVATE_KEY` | (enables adapter) | x25519 private key. Generate with `xray x25519`. |
| `XRAY_REALITY_SHORT_IDS` | (none, required) | Comma-separated REALITY shortIds (e.g. `abc123,def456`). Adding or removing rebuilds the inbound. |
| `XRAY_REALITY_SERVER_NAMES` | `www.cloudflare.com` | Comma-separated SNI values clients may claim. |
| `XRAY_REALITY_DEST` | `www.cloudflare.com:443` | TLS handshake target the inbound forwards mismatched probes to. |
| `XRAY_PORT` | `443` | TCP port the Xray inbound listens on. |
| `XRAY_BINARY` | (none) | Path to `xray` executable. Empty means config-only mode (writes `config.json` but doesn't spawn xray). |
| `XRAY_API_PORT` | `8080` | Loopback port for the gRPC StatsService inbound. The adapter shells out to `xray api statsquery -server 127.0.0.1:<port>` to read and drain per-user byte counters every poll. Always binds 127.0.0.1; never expose externally. |
| `XRAY_CONFIG` | `/etc/xray/config.json` | Path the adapter writes the generated config to. |

### Shadowsocks

Shares the xray binary, auto-registers when `XRAY_BINARY` is set. Stays inert until the panel pushes an `ApplyInbound` with a method, then spawns its own xray subprocess on a separate config and listen port.

| Var | Default | Description |
|---|---|---|
| `SHADOWSOCKS_CONFIG` | `/etc/xray/shadowsocks.json` | Path for the SS-specific xray config (separate from the VLESS one). |
| `SHADOWSOCKS_PORT` | `8388` | TCP port the SS inbound listens on (historic SS default). |
| `SHADOWSOCKS_API_PORT` | `8081` | Loopback port for the gRPC StatsService. Set one above `XRAY_API_PORT` (8080) to avoid conflict if both run on the same node. Always binds 127.0.0.1. |
| `SHADOWSOCKS_METHOD` | (none) | Cipher pre-seed. Empty means wait for first ApplyInbound. Valid: `2022-blake3-aes-{128,256}-gcm`, `2022-blake3-chacha20-poly1305`, `chacha20-ietf-poly1305`, `aes-{128,256}-gcm`. |

Per-user password is `user.xrayUuid` (no separate credential).

### NaiveProxy

NaiveProxy multi-user mode requires a custom Caddy build with the `klzgrad/forwardproxy@naive` plugin (the upstream `naive` standalone is single-tenant only). Run the bootstrap script once per VPS:

```bash
sudo bash apps/node/scripts/bootstrap-naive.sh
```

Installs Go if missing, then xcaddy, then compiles `/usr/local/bin/caddy-naive` with the forward_proxy plugin linked in. Re-run periodically to keep the Chromium-coupled TLS fingerprint fresh; NaiveProxy upstream bumps the Chromium baseline roughly every 30 days.

### AmneziaWG

Before the agent can manage AmneziaWG inbounds, the host needs the `amneziawg` kernel module and `awg` / `awg-quick` userspace tools. Bootstrap script as root:

```bash
sudo bash apps/node/scripts/bootstrap-amneziawg.sh
```

Installs the upstream PPA (Ubuntu/Debian only), pulls `amneziawg`, `amneziawg-tools`, `amneziawg-dkms`, then verifies the kernel module loads. On DKMS failure (ARM containers, custom kernels) the script prints the userspace `amneziawg-go` fallback path; throughput drops from kernel-native (~92 Mbps) to userspace (~33 Mbps) but the inbound still works.

## Build

```bash
cd apps/node
go build -o iceslab-node .
```

## Run

```bash
NODE_PAYLOAD="$(cat payload.b64)" ./iceslab-node
```

## Endpoints

All endpoints require panel mTLS client cert (`tls.RequireAndVerifyClientCert`).

| Method | Path | Notes |
|---|---|---|
| GET  | `/healthz`     | Returns `{ status, cores: [{name, running}] }`. `status: 'degraded'` if any adapter unhealthy. |
| POST | `/addUser`     | Fan-out to all registered adapters. |
| POST | `/removeUser`  | Fan-out to all registered adapters. |
| GET  | `/stats`       | Aggregated counters across adapters. |

Per-adapter behaviour:

- Hysteria - `AddUser` updates the in-memory password→user map; client reconnects authenticate via the local `/auth` callback. No subprocess restart.
- Xray - `AddUser` rewrites `config.json` and restarts the xray subprocess (~1s downtime per mutation). Live management via gRPC `proxyman.HandlerService.AlterInbound` is on the roadmap.
