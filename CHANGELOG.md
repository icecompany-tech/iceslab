# Changelog

All notable changes to Iceslab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

## v0.1.2

Stabilization release: security hardening across the node-agent and installers,
a batch of panel performance fixes, and completion of the per-protocol port
wiring so port changes from the UI take effect on every core.

### Security

- **node-agent: config-injection guards.** AmneziaWG renders peer keys / AllowedIPs
  into the awg-quick INI and Hysteria renders obfs password / masquerade URL into
  YAML. Both now whitelist input (base64 WG keys, CIDR, no YAML metacharacters) so
  a hostile or buggy panel push can't break out of the config and inject
  `PostUp=` / top-level directives that run as root.
- **node-agent: constant-time panel-cert fingerprint compare**, mtproto Secret
  hex validation, Shadowsocks config now written via the atomic fsync helper
  (was a non-durable WriteFile+rename).
- **panel-auth: per-(IP, username) login lockout.** Username-only lockout let any
  bot lock out the real admin from a different IP; confirmed live during a
  distributed brute-force. Lockout state is now keyed on the source IP too.
- **panel-auth:** `cookie.secure` driven by `NODE_ENV`, admin usernames redacted
  in Telegram login alerts.
- **panel-backend: per-route auth.** Plugin-level `addHook` auth replaced with
  per-route `onRequest` across 9 route plugins so a future public route can't
  silently inherit no-auth (Fastify v5 quirk).
- **installer: supply-chain + token-leak hardening.** `--bootstrap-file` keeps
  the bootstrap token out of `/proc/cmdline`; optional `ICESLAB_REF_SHA` pins the
  expected commit so a re-pointed tag aborts the install. `fail2ban` jails for
  auth brute-force + probe scanners in domain mode.

### Fixed

- **installer pinned to v0.1.0.** Default `ICESLAB_REF` / `ICESLAB_NODE_REF` were
  still `v0.1.0`, so fresh installs pulled stale code with bugs already fixed in
  later releases. Now pinned to `v0.1.2`. ([#1](https://github.com/icecompany-tech/iceslab/issues/1))
- **per-protocol port wiring.** `ApplyInbound` now receives the panel binding
  port and every adapter (hysteria, amneziawg, xray, naive, shadowsocks, mtproto,
  mieru) rebinds to it. Previously the port was install-time only and UI port
  changes were silently dropped.
- **node-agent default port 8443 → 1337.** 8443 is the first port every scanner
  probes after 443; 1337 stays out of standard scanner profiles and frees 8443
  for a normal user-protocol binding. Existing nodes keep their pinned port.
- **quick-deploy picks the first free port** from `[443, 8443, 2053, 2083, 2087,
  2096]` instead of hardcoding 443 (which 409'd on any second binding). The UI
  flags a collision with the node-agent's own mTLS port.
- **node-agent fanout is best-effort.** A dormant/not-yet-Healthy adapter failing
  during addUser/removeUser no longer 500s the whole request (was breaking
  first-time backfill on fresh nodes).
- **heartbeat trusts system CAs + panel CA** so an LE-fronted public panel stops
  logging `certificate signed by unknown authority` on every heartbeat.
- **cron clears stale `lastStatusMessage`** when a node recovers from `degraded`
  (the old guard never re-wrote when the new message was empty).
- **MTProto tg:// URI** no longer carries a `#fragment` that strict Telegram
  parsers rejected.

### Performance

- **AWG IP allocation in one SQL round-trip** (was 3 queries + a 254-candidate
  JS scan per user).
- **inbounds-sync batches addUser** in bounded-parallel chunks instead of N
  serial mTLS round-trips.
- **UsersPage server-side pagination** + debounced search (was fetching up to 500
  users and paging in JS, silently truncating larger installs).
- **AppLayout reads sidebar counts from the dashboard cache** — one request
  instead of four full-list queries on every page transition.
- **removeUser cron enqueues deduped by jobId** (a stable orphan was re-enqueued
  ~144×/day).
- **dropped a redundant 10s dashboard poll** inside the node edit modal.

### Docs

- README: "Running multiple protocols on one node" section and an installer
  env-var table (`ICESLAB_REF`, `SKIP_SWAP`, `NODE_PORT`, `FRONTEND_PORT`).
  Russian README kept in parity.

## v0.1.1

First post-publication stabilization pass: docker-compose healthcheck path fix
(the first-install blocker), pnpm-install OOM mitigation on 2 GB VPS, dashboard
heap-percentage fix, login-lockout default relaxation, Subscription sidebar
section, and assorted i18n cleanup.

## v0.1.0

Initial public release: multi-core proxy operator panel (Hysteria 2 / Xray
REALITY / AmneziaWG / NaiveProxy / Shadowsocks 2022 / MTProto / Mieru) with
TypeScript Fastify backend, React Mantine SPA, and a Go node-agent over mTLS.
