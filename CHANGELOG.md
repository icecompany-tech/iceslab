# Changelog

All notable changes to Iceslab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

## v0.1.8

Operator production-readiness, surfaced by dogfooding a real paid service on
Iceslab: kill or rotate a leaked subscription link, reset a user's traffic on
demand, and scope API tokens to least privilege. Plus multi-hop cascades
validated end to end on real nodes for the first time (RU entry to EU exit, the
client's egress IP becomes the exit's), which surfaced and closed two real
defects along the way, a read-only demo build of the panel for the landing page,
the full set of well-known client detection rules with an inline enable toggle,
a per-profile reach count that ignores deleted users, and a batch of form and
stats polish.

### Added

- **Revoke and rotate a subscription link.** Kill a leaked or abused link (it
  returns 403 until rotated), or rotate it to issue a fresh token that kills the
  old link immediately. From the Users page or the API.
- **On-demand traffic reset.** Zero a user's used traffic and lift a traffic
  limit in one action (period-billing top-up) without waiting for a cron reset;
  a limited user goes straight back to active and is re-provisioned.
- **API tokens enforce scopes.** A token can be least-privilege now: one scoped
  to users plus subscription-read cannot reach settings, nodes, or token
  management. Existing full-access tokens are unaffected; pick a scope preset
  when creating a token.
- **Import an existing subscription token on user create.** Operators migrating
  in keep their clients' current links instead of forcing a re-import.
- **Read-only demo build of the panel.** A VITE_DEMO_MODE build serves the real
  UI from local fixtures (auto-login, every change a no-op) for embedding on a
  landing page, and reads ?lang= for its start language. Tree-shaken out of the
  normal build.
- **All well-known subscription clients are seeded.** The User-Agent detection
  rules now cover the clients that previously had no rule and fell through to the
  base64 list they cannot parse: Surge and Surfboard, Quantumult X, Loon, Outline,
  XKeen, plus Karing, Throne and FoXray, and explicit plain-list rules for
  Shadowrocket, Streisand, V2Box and Happ. Idempotent seed.
- **Inline enable/disable toggle on the subscription rules table.** Turn a rule
  on or off in place without opening the editor; optimistic with rollback on
  failure.

### Fixed

- **Enabling a cascade now reaches the nodes.** Creating, editing or deleting a
  cascade emitted no event, so the chaining fragments only lived in the database
  and never pushed to the hop nodes until some unrelated profile or binding edit
  fired a re-sync. The cascade service now re-pushes every node that is or was a
  hop (so disabled or removed hops also drop their fragments).
- **The node-agent opens the cascade link port itself.** The inter-hop link
  listens on a high port that install-time firewall rules do not know about, so
  it previously had to be opened by hand (`ufw allow from <entry-ip> ...`) or the
  forward was silently dropped. The panel now sends the link port and the peer
  hop's address with the cascade fragment, and the agent opens UFW for it,
  restricted to that peer (resolving a hostname to its IP, falling open only if
  it cannot be pinned). Applied on push and re-ensured on boot.
- **A node reporting one user twice no longer rolls back its stats.** When a node
  reported the same user on two protocols (for example VLESS plus Shadowsocks),
  the cumulative-snapshot upsert received a duplicate row and Postgres aborted the
  whole transaction, so that node recorded nothing. The duplicates are now summed
  into one entry per user. This was why cascade nodes showed zero traffic.
- **Per-profile user reach excludes deleted users.** A profile's "users with
  access" count included soft-deleted users (their squad membership is kept for
  restore), so one live user could read as four. The reach query now joins live
  users only.
- **Implausible per-poll traffic deltas are discarded.** A node reporting more
  than a terabyte for one user in a single 30-second poll is re-billing its
  lifetime counter (an outdated agent), not real traffic; the panel now drops such
  a delta and logs it instead of corrupting quotas and node history.
- **Form and tab polish.** New profiles default to Xray (REALITY) instead of
  Hysteria, the REALITY option rows bottom-align instead of staggering, the long
  node bootstrap payload wraps inside its box instead of overflowing, and the
  favicon is wired into the page.

## v0.1.7

The censorship-survival work from v0.1.6 made functional and field-ready: the
REALITY self-steal vertical actually works end to end now, traffic accounting is
zero-loss across restarts, and admin two-factor is hardened against code replay.
Plus the full advanced Xray option surface and an opt-in probe-resistance knob,
TLS-fragment, per-user and China routing presets, a Shadowsocks cascade link, a
realistic self-steal fallback, and live Shadowsocks user management.
Self-steal and the node-hardening toggles ship functional with real-network
field-validation in progress (the maturity bar v0.1.6 used for its experimental
features).

### Security

- **TOTP replay rejected within the validity window.** A one-time code can no
  longer be reused inside its 30-second step: the last-accepted step is recorded
  and a login presenting a step at or below it is refused. Closes the small
  replay window the initial TOTP work left open.

### Added

- **Advanced Xray options, tabbed.** The profile form's Xray section moved to
  tabs (REALITY / TLS / Transport) and exposes the previously hidden option
  surface: REALITY xver and max-time-diff, TLS reject-unknown-SNI, XHTTP mode and
  request-padding, gRPC multi-mode.
- **REALITY fallback rate-limit (probe resistance, opt-in).** An optional
  per-direction throttle on unverified fallback connections, so a scanner that
  fails REALITY auth is forwarded to the target slowly and sees a slow site
  rather than a full-speed proxy. Off by default: the throttle is itself a
  detectable pattern, so it stays an expert opt-in.
- **TLS-fragment (opt-in, Xray-JSON).** A subscription can fragment the client
  ClientHello so SNI-based DPI cannot cleanly match the handshake. Off by
  default; toggle via a panel setting or the `?fragment=` query. Emitted only
  into the Xray-JSON format (a freedom fragment outbound the proxy dials
  through); intentionally not sing-box (the upstream field is unstable).
- **Per-user routing override + operator custom domain lists (R3).** A routing
  preset can now be set per user (winning over the squad and global defaults),
  and an operator can define direct / proxy / block domain lists emitted into the
  Xray-JSON and Clash routing rules. Empty or unset leaves output unchanged.
- **China routing preset (cn-split, H2).** A China-direct mirror of ru-split:
  China domains and IPs resolve and egress direct (clean DNS via AliDNS),
  everything else tunneled. Across Xray-JSON, Clash and sing-box.
- **Shadowsocks cascade link cell (C3b).** A multi-hop cascade can use a
  Shadowsocks-2022 inter-hop link in addition to VLESS, including mixed chains.
  Node-to-node link only; the entry hop still does the DPI evasion.
- **Realistic self-steal fallback (G1, opt-in).** A self-steal node can
  reverse-proxy unverified probe requests to a real upstream site instead of the
  stub page, so a deep prober sees genuine content. Off by default (static
  landing); any upstream error falls back to the static page.

### Changed

- **Zero-loss traffic accounting.** Per-user stats are now drained
  non-destructively: the node reports cumulative counters and the panel computes
  the delta against a stored per-node-per-user snapshot in the same transaction
  as the increment. A failed or retried stats write can no longer lose a slice of
  a user's traffic the way the previous reset-on-read drain could.
- **Frontend API base URL defaults to same-origin in production.** Production
  builds talk to their own origin instead of a hardcoded localhost, so the panel
  works served from anywhere without a build-time override.
- **Dependency audit gate kept clean.** Two transitive advisories pulled to
  patched versions via overrides so the production audit gate stays green.
- **Live Shadowsocks user management (N1-SS).** Adding or removing a Shadowsocks
  user now goes through the running core's runtime API with no restart (live
  connections preserved), matching the Xray live-management path, with the same
  config-restart fallback when the runtime call cannot be made.
- **Stricter REALITY target check (H1).** The pre-deploy test-connect now also
  verifies the masquerade target negotiates HTTP/2, not just TLS 1.3, and
  surfaces a single health note: a CDN-grade dest should speak both.

### Fixed

- **REALITY self-steal now works end to end.** Two wiring defects made self-steal
  silently degrade to borrowing an external TLS identity (the mode that
  mismatches under aggressive DPI): the camouflage-mode field was dropped by the
  config schema before it reached the node, and the per-node domain was pushed
  under the wrong wire key so the node received an empty server-name list. Both
  fixed, plus the node is re-pushed when its domain changes. The self-steal
  vertical is now functional (real-network validation pending).
- **Add and remove of a user converge under rapid status changes.** A user
  toggled active and limited in quick succession could leave the node user set
  out of sync with the panel; the sync now gates on the live desired status so
  the node converges to the correct set.
- **Node firewall self-heals on boot.** UFW was only opened for an inbound's port
  inside the applyInbounds push handler, so a node that restarted (or whose rule
  was lost to a reimage, or to a transient `ufw allow` that has no retry) could
  run its core with the port closed until the next push. The agent now re-ensures
  UFW for every persisted inbound on startup. Caught live: xray reachable from
  abroad but the binding port was firewalled.

## v0.1.6

The largest release since the alpha opened: a censorship-survival toolkit for
hostile networks (routing presets, multi-hop cascades, REALITY self-steal), live
user management with no restarts, admin two-factor auth, operator analytics and a
Telegram bot, far broader client-app coverage, and a deep performance and
reliability audit across both the panel and the node-agent.

### Security

- **Admin two-factor auth (TOTP).** Optional RFC6238 TOTP on the admin login,
  with a guided enrollment (enable requires a confirmed code, so you cannot lock
  yourself out) and a disable flow. Recovery is a single SQL update if a device
  is lost. Additive: existing logins are untouched until an admin opts in.

### Added

- **Routing presets with split-DNS.** A subscription can carry a `ru-split`
  preset (ads and local destinations resolve and egress direct, everything else
  is tunneled), rendered correctly into the Xray-JSON, Clash and sing-box
  formats with a matching split-DNS block so lookups do not leak. Selectable per
  subscription, per squad (override), or via a `?routing=` query, plus a raw
  custom-rules editor for hand-written Xray routing rules.
- **Multi-hop cascades (experimental).** Chain nodes entry -> transit -> exit:
  the client connects to an entry node and traffic is forwarded hop to hop to an
  exit that egresses direct. Full operator UI (hop builder, reorder, validation)
  plus node-agent forwarding for the Xray vless cell. Built for networks where a
  single foreign hop is blocked; field validation is in progress.
- **REALITY self-steal (experimental).** A REALITY mode where the node runs its
  own local TLS fallback and presents its own domain, so the SNI and the server
  IP stay consistent (the mismatch that gets a borrowed-SNI REALITY connection
  mangled on aggressive DPI). Selectable per profile.
- **Live user add and remove with no restart.** Adding or removing an Xray or
  Shadowsocks user now goes through the core's runtime management API, so live
  connections are never dropped. It falls back to the previous config-restart
  path only when the runtime call cannot be made, so it can only improve on the
  old behaviour.
- **Operator analytics.** Dashboard bandwidth now shows deltas against the prior
  period on every window, plus a new Insights page: a subscription-request
  breakdown by client app and a HWID device-count distribution, both computed
  from already-stored data with no new tracking.
- **Operator Telegram bot.** A read-only bot answering `/status` and
  `/user <name>` to the operator chat, plus a daily digest of users near expiry
  or near their traffic cap.
- **Signed outbound webhooks.** User, profile and node events are forwarded to
  configured URLs with an HMAC-SHA256 signature over the payload.
- **Broader client-app coverage.** New subscription formats: XKeen (Xray confdir
  for Keenetic routers), Outline / SIP008, Surge, Quantumult X and Loon.
- **Multi-core node UX.** Add a second protocol to an existing node from the node
  view, with an auto-picked free port and a human-readable message when a port is
  already taken. Plus a masquerade REALITY recipe and a test-connect that probes
  the REALITY dest for resolvability and TLS 1.3.
- **Per-squad defaults.** A squad can carry a routing-preset override and a
  default HWID device limit.

### Changed

- **Panel performance pass.** Response schemas for fast JSON serialization on the
  hot dashboard and user-list endpoints, in-process caches for subscription
  settings, squad bindings and blacklist lookups (all write-busted), bulk
  single-statement traffic upserts and AmneziaWG peer pre-allocation, cursor
  pagination on backfill, and lazy-loaded frontend routes (initial bundle cut by
  about a third).
- **Node-agent reliability.** Adapter locks are split so a multi-second core
  restart no longer blocks health checks or the panel's push workers, a bounded
  restart-on-crash supervisor backs every spawned core, subprocesses are
  group-killed so no orphans leak, and stats and health probes run concurrently
  with cached AmneziaWG and UFW reads plus zero-user short-circuits.

### Fixed

- **AmneziaWG runaway traffic.** AWG reported kernel-cumulative counters where the
  panel expected per-poll deltas, so a peer's lifetime total was re-billed on
  every poll and drained quotas. The agent now emits true deltas (baseline on
  first sight, so an agent restart never re-bills the backlog).
- **Editing a limited or expired user no longer fails.** Saving such a user
  returned 400 on every attempt; it now reactivates correctly, and a 0 GB
  traffic limit is read as unlimited.
- **Per-user stats no longer error on multi-inbound users.** A user present on
  more than one inbound of a node tripped a Postgres conflict (21000); per-user
  rows are aggregated before the bulk upsert.
- **Smaller audit fixes.** IPv6-aware subscription host parsing, a human-readable
  port-conflict 409 naming the node and profile, an online-aware node status dot,
  a flag-emoji guard for non-ISO country codes, a bounded Hysteria auth-callback
  body, and a settings form that re-seeds from the server after save.

## v0.1.5

Full Xray protocol matrix: VLESS, VMess and Trojan over any transport and any
security mode, behind a guided picker. Plus an update-available indicator and a
round of VPS hardening.

### Security

- **nginx ships hardening headers.** `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `server_tokens off` on every response. CSP is left to the
  operator so a wrong policy can't silently break the SPA.

### Added

- **Full Xray protocol matrix.** A profile can now run VLESS, VMess or Trojan over
  any of the six transports (raw, WebSocket, gRPC, xHTTP, HTTPUpgrade, mKCP) and
  any security mode: REALITY, plain `none` (for a CDN that terminates TLS itself),
  or node-terminated TLS with your own certificate. A guided three-step picker
  (protocol, then transport, then security) reveals only the fields each
  combination needs, and every combination is emitted correctly into the
  raw/base64, Clash, sing-box and Xray-JSON subscription formats.
- **Update-available indicator.** The sidebar shows an accent dot linking to the
  release when a newer version ships. The panel checks the latest GitHub release
  (cached 6h, best-effort: it never blocks a request or breaks if GitHub is
  unreachable, and needs no token on the public repo).

### Changed

- **Subscription formatters are security-aware.** Clash, sing-box and Xray-JSON
  hardcoded REALITY for every Xray endpoint, so a `none` or `tls` profile would
  have produced a broken client config. They now render the correct security
  block per endpoint and carry all three subprotocols.
- **VPS resource and secret safety.** Redis is capped (`--maxmemory` with
  `noeviction`, so a runaway can't OOM a small host and queued jobs are never
  silently dropped), and `deploy.sh` snapshots `.env.production` (the only on-host
  copy of the JWT secret, DB password and node mTLS CA) to a timestamped backup
  ring before each deploy.

## v0.1.4

Reliability hardening after a deep code audit: the bug-fix campaign, a deploy/
update fix so operators stop getting stuck on stale code, and a round of UI polish.

### Fixed

- **node-agent no longer stalls during a core restart.** Adapter mutexes were
  held across the multi-second subprocess restart (xray / shadowsocks / mtproto /
  mieru / naive), blocking `/healthz` and the panel's push workers, plus a data
  race on the Hysteria auth-callback. Locks are split so restarts run lock-free.
- **deploy/update no longer silently rebuilds stale code.** `deploy*.sh` ran
  `git pull --ff-only`, a no-op on the tag-pinned detached HEAD the installer
  leaves behind, so re-deploys quietly rebuilt the old version. They now sync to
  `ICESLAB_REF` (branch or tag), fetch all refs, and fail loudly on an ambiguous
  detached HEAD. The installer is a full clone so updates stay reachable.
- **deploy applies new migrations.** Migrations ran against the previous image
  before the rebuild, so a deploy that added a migration silently skipped it.
  Reordered to build, then migrate, then start.
- **multi-profile deploy to a fresh node.** Deploying several profiles to a new
  node assigned port 443 to every one, so all but the first failed with
  PORT_IN_USE. Each profile now gets a distinct port.
- **"Top users today" dashboard card** was always empty (the table it reads was
  never written); the stats poll now records per-user daily usage.
- Subscription endpoint name de-dup, inline port-edit collision check, bounded
  AmneziaWG IP allocation, and other audit fixes.

### Changed

- **Protocol dropdown** lists Xray first with a disabled "sing-box (soon)" teaser
  everywhere a protocol is chosen.
- **UI polish.** The Users status chips are now the single filter (dropped a
  duplicate control); node cards show the node address; filter chips are
  keyboard-operable.
- **Build resilience.** `prisma generate` retries on a flaky network during the
  Docker build, and the Prisma update-check call is disabled.

## v0.1.3

Subscription self-service for end users, plus a dashboard CPU-reporting fix
and an ops-script papercut.

### Added

- **Human-readable subscription page.** Opening `/sub/<token>` in a browser
  used to dump raw base64 ([#1](https://github.com/icecompany-tech/iceslab/issues/1)).
  It now serves a self-contained landing page: status (traffic / expiry /
  protocols), a copy-able subscription link, deep-link import buttons
  (Hiddify / Streisand / v2rayNG / Clash), and per-format download buttons
  including the AmneziaWG `.conf`. RU/EN by Accept-Language. VPN clients are
  unaffected (an explicit `?format=` always wins).
- **QR codes on the subscription page.** One QR for the subscription URL
  (scan to import in proxy clients) and, when an AmneziaWG endpoint exists, a
  QR of the wg-quick config text (scan straight into AmneziaVPN). Generated
  server-side as inline SVG via `qrcode-svg` (zero external requests).

### Fixed

- **Dashboard CPU headline.** The host CPU card showed a 200ms instantaneous
  sample taken while the backend builds the overview, so a 1-vCPU host saw
  its own work as an 80%+ spike. The headline now uses the 1-minute
  load-average percentage (sustained busy-ness); the sample stays as
  secondary detail.
- **Ops scripts run from anywhere.** `deploy.sh` / `restore.sh` / etc. errored
  when run from `scripts/` instead of the project root. They now auto-resolve
  the root, so `cd scripts && ./deploy.sh` works too.

### Performance

- **Dashboard overview cache TTL 8s → 30s.** At 8s the cache expired before
  almost every poll, so the ~20-query recompute ran every ~10s and pegged
  small hosts. Now throttled to at most twice a minute regardless of tab count.

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
- **AppLayout reads sidebar counts from the dashboard cache** - one request
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
