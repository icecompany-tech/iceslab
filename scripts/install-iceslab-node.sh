#!/usr/bin/env bash
# Iceslab node-agent one-command installer.
#
# What it does:
#   1. Verifies Go + git (installs them on Ubuntu/Debian if missing)
#   2. Clones repo into $ICESLAB_NODE_DIR (default /opt/iceslab-node)
#   3. Builds the static node-agent binary → /usr/local/bin/iceslab-node
#   4. (per --protocol) chains the protocol-specific bootstrap:
#        hysteria     → installs official hysteria via get.hy2.sh
#        xray         → installs official xray via XTLS install-script
#        amneziawg    → runs apps/node/scripts/bootstrap-amneziawg.sh
#        naive        → runs apps/node/scripts/bootstrap-naive.sh (xcaddy + plugin)
#        shadowsocks  → reuses xray-core (SS2022 multi-user runs inside xray)
#        mtproto      → runs apps/node/scripts/bootstrap-mtg.sh (9seconds/mtg)
#        mieru        → runs apps/node/scripts/bootstrap-mieru.sh (enfein/mieru)
#   5. Drops a systemd unit at /etc/systemd/system/iceslab-node.service
#   6. Writes /etc/iceslab-node/env with NODE_PAYLOAD + protocol env
#   7. Enables + starts the service, waits for /healthz
#
# Usage (as root). RECOMMENDED — bootstrap-token flow (single command, no
# manual file transfer needed):
#
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_AbC123dEf456 \
#     --protocol xray
#
# Get the bootstrap token + ready-made command by clicking "Create node"
# in the panel UI — the modal shows a copy-pastable single-liner. Token is
# valid 15 min, single-use; if it expires, click "Refresh bootstrap" in
# the panel UI to mint a new one.
#
# Security note: `--bootstrap <tok>` exposes the token in /proc/<pid>/cmdline
# for the lifetime of the install (any local unprivileged process can read
# it). For shared VPS or audit-logged hosts, write the token to a 0600 file
# and pass `--bootstrap-file /path/to/token` instead — token never enters
# argv. Convention matches --payload-file.
#
# === ONE-COMMAND PROTOCOL SETUP ===
#
# For a fully-configured node — node-agent + protocol server + systemd unit
# + ACME cert — pass per-protocol flags. Otherwise install-iceslab-node.sh installs
# the binaries and you have to drop config files manually.
#
# Hysteria 2 — auto-configure server with LE-issued cert + masquerade:
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --protocol hysteria \
#     --hysteria-domain hy2-01.example.com \
#     --hysteria-email admin@example.com
#   # Optional: --hysteria-masquerade-url https://en.wikipedia.org/
#   #           --hysteria-obfs-password <salamander-pwd>
#   #           --hysteria-port-range 20000-50000   (slice 31.5 port-hopping;
#   #             defeats RU TSPU UDP/443 throttle. Pass "" to disable.)
#
# Xray — pre-fill REALITY env so adapter starts immediately. Get keypair
# from the inbound creation form (panel UI → Inbounds → Create → Generate):
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --protocol xray \
#     --xray-reality-private-key sI_p9bg-7cy... \
#     --xray-reality-short-ids abc123 \
#     --xray-reality-server-names www.cloudflare.com \
#     --xray-reality-dest www.cloudflare.com:443
#   # Optional: --xray-port 443
#
# AmneziaWG / NaiveProxy / Shadowsocks / MTProto / Mieru — these protocols
# take no install-time flags; they start idle and wait for the panel to push
# inbound config via applyInbounds. Set protocol-specific fields (domain,
# email, masquerade, etc.) on the panel-side Profile via the admin UI.
#
# Alternative flows (file-based — for air-gapped or self-hosted gist setups):
#   bash <(curl -fsSL .../install-iceslab-node.sh) --protocol xray --payload-file /tmp/payload.b64
#   bash <(curl -fsSL .../install-iceslab-node.sh) --protocol xray --payload "@/tmp/payload.b64"
#
# Or interactive:
#   bash <(curl -fsSL .../install-iceslab-node.sh)
# (asks for protocol, then payload — accepts `@/path/to/file` syntax).
#
# **Don't paste the raw payload string into the terminal directly.** Linux
# TTY canonical-mode truncates pastes at 4096 bytes; real payloads are ~6-7
# KB, so the tail gets silently dropped and the node fails with a confusing
# `json unmarshal: unexpected end of JSON input`.
#
# Re-runnable. Existing /etc/iceslab-node/env is preserved unless --payload
# (or --payload-file or --bootstrap) is given again.
#
# === RE-INSTALL / UNINSTALL ===
#
# When the panel is rebuilt, deleted-and-recreated, or you've registered the
# node fresh in the panel UI, the old server cert on the VPS won't validate
# against the new panel CA. Two flags handle this:
#
#   bash <(curl -fsSL .../install-iceslab-node.sh) --reset \
#     --panel-url ... --bootstrap ... --protocol ...
#     # wipes prior state silently, then installs fresh
#
#   bash <(curl -fsSL .../install-iceslab-node.sh) --uninstall
#     # stops + disables systemd unit, removes binary, /etc/iceslab-node,
#     # /opt/iceslab-node, and the UFW allow-rule for $NODE_PORT/tcp.
#     # Per-protocol services (xray.service, etc) are kept intact.
#
# Without either flag, an existing install triggers an interactive prompt.

set -euo pipefail

log()  { printf '\033[1;34m[iceslab-node]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }

INSTALL_START_TS=$(date +%s)
LAST_STEP_TS=$INSTALL_START_TS
LAST_STEP_LABEL="(pre-flight)"

fmt_duration() {
  local total=$1
  local m=$((total / 60))
  local s=$((total % 60))
  if [[ "$m" -gt 0 ]]; then
    printf '%dm%02ds' "$m" "$s"
  else
    printf '%ds' "$s"
  fi
}
elapsed_total() { fmt_duration "$(( $(date +%s) - INSTALL_START_TS ))"; }
elapsed_step()  { fmt_duration "$(( $(date +%s) - LAST_STEP_TS ))"; }

STEP_N=0
STEP_TOTAL=8
step() {
  if [[ "$STEP_N" -gt 0 ]]; then
    printf '\033[2m       step %d done in %s\033[0m\n' "$STEP_N" "$(elapsed_step)"
  fi
  STEP_N=$((STEP_N + 1))
  LAST_STEP_TS=$(date +%s)
  LAST_STEP_LABEL="$*"
  printf '\n\033[1;36m[%d/%d]\033[0m \033[1m%s\033[0m  \033[2m(+%s total)\033[0m\n' \
    "$STEP_N" "$STEP_TOTAL" "$*" "$(elapsed_total)"
}

on_error() {
  local exit_code=$?
  local line_no=$1
  local cmd=$2
  printf '\n\033[1;31m✗ install-iceslab-node.sh failed\033[0m\n' >&2
  printf '  Step:    [%d/%d] %s\n' "$STEP_N" "$STEP_TOTAL" "$LAST_STEP_LABEL" >&2
  printf '  Where:   %s line %d\n' "${BASH_SOURCE[0]:-script}" "$line_no" >&2
  printf '  Command: %s\n' "$cmd" >&2
  printf '  Exit:    %d\n' "$exit_code" >&2
  printf '  Step time:  %s\n' "$(elapsed_step)" >&2
  printf '  Total time: %s\n' "$(elapsed_total)" >&2
  printf '\n' >&2
  if [[ -r /tmp/install-node.log ]]; then
    printf '  Last 30 log lines (/tmp/install-node.log):\n' >&2
    tail -60 /tmp/install-node.log \
      | grep -v -E '^(✗ install-iceslab.*failed|  (Step|Where|Command|Exit|Step time|Total time|Last [0-9]+ log lines|  Re-run with):|    )' \
      | tail -30 \
      | sed "s/^/    /" >&2
    printf '\n' >&2
  fi
  printf '  Re-run with the same flags — install is idempotent.\n' >&2
  exit "$exit_code"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

banner() {
  printf '\n'
  printf '\033[1;36m  ___ ___ ___ ___  _      _   ___\n'
  printf ' |_ _/ __| __/ __|| |    /_\\ | _ )\n'
  printf '  | | (__| _|\\__ \\| |__ / _ \\| _ \\\n'
  printf ' |___\\___|___|___/|____/_/ \\_\\___/\033[0m  node-agent\n'
  printf '\n'
  printf '  v0.1.6  ·  github.com/icecompany-tech/iceslab\n'
  printf '\n'
}

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash $0)"

banner

# ───── Concurrency + apt lock hygiene ─────
# Same protections as install-iceslab.sh — flock against concurrent runs,
# graceful wait on apt locks via DPkg::Lock::Timeout, stale-lock cleanup
# for the orphan-apt-process case. See install-iceslab.sh for the rationale.
exec 9>/var/run/iceslab-node-install.lock || fail "cannot open install lockfile"
if ! flock -n 9; then
  fail "another install-iceslab-node.sh is already running. Wait, or remove /var/run/iceslab-node-install.lock if you're sure it crashed."
fi

APT_OPTS=(-o "DPkg::Lock::Timeout=300" -o "Dpkg::Options::=--force-confold" -o "Dpkg::Options::=--force-confdef")
APT_ENV=(env DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none)

cleanup_stale_apt_locks() {
  local lock_holder
  for lockfile in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock; do
    [[ -e "$lockfile" ]] || continue
    lock_holder=$(fuser "$lockfile" 2>/dev/null || true)
    if [[ -z "$lock_holder" ]]; then
      log "stale apt lock at $lockfile — removing"
      rm -f "$lockfile"
    fi
  done
  dpkg --configure -a >/dev/null 2>&1 || true
}
cleanup_stale_apt_locks

ICESLAB_NODE_DIR=${ICESLAB_NODE_DIR:-/opt/iceslab-node}
ICESLAB_NODE_REPO=${ICESLAB_NODE_REPO:-https://github.com/icecompany-tech/iceslab.git}
ICESLAB_NODE_REF=${ICESLAB_NODE_REF:-v0.1.6}

# ───── Third-party installer pinning (supply-chain) ─────
#
# Hysteria and Xray installers previously ran as `bash <(curl get.hy2.sh)`
# and `XTLS/Xray-install/raw/main/...` — both unpinned, executing whatever
# the upstream `main`/HTTP host serves at the moment of install. A
# compromise of either upstream (or a DNS hijack on the box) gave the
# attacker root.
#
# Pinning: fetch the installer from a specific tag/commit, OPTIONALLY
# verify a sha256, then run. Operators who want full supply-chain
# hardening set the *_SHA env var; default is tag-pin only (still a huge
# improvement over `main`). To bump: pick a new tag, run the installer
# once with --dry-pin to print the sha, paste it back here.
# Hysteria: apernet/hysteria releases the server/client under the `app/v*`
# tag prefix (their `v*` tags are for the legacy hysteria-v1 lineage and
# do NOT have the server install script). Bump to a later app/* tag as
# upstream releases.
HYSTERIA_INSTALLER_REF=${HYSTERIA_INSTALLER_REF:-app/v2.9.1}
HYSTERIA_INSTALLER_SHA=${HYSTERIA_INSTALLER_SHA:-}
HYSTERIA_VERSION=${HYSTERIA_VERSION:-}   # passed as --version to the script; empty = installer default

# Xray-install: XTLS/Xray-install publishes ZERO tags/releases — only a
# `main` branch. We pin to a specific commit SHA so a hostile commit to
# main doesn't auto-deploy. Bump by reading `git rev-parse main` on the
# upstream repo and updating both this default and SECURITY.md. The
# `pinned_fetch` SHA-256 knob (XRAY_INSTALLER_SHA) is the second line of
# defence — production operators should set it.
XRAY_INSTALLER_REF=${XRAY_INSTALLER_REF:-e741a4f56d368afbb9e5be3361b40c4552d3710d}
XRAY_INSTALLER_SHA=${XRAY_INSTALLER_SHA:-}

# pinned_fetch <url> <out-path> [<expected-sha256>]
# Fetches a URL over HTTPS with no redirects, optionally verifying the
# sha256. --proto =https blocks accidental http:// downgrade; --max-redirs 0
# closes the MITM-via-302 vector. Refuses to write if sha mismatches.
pinned_fetch() {
  local url="$1" out="$2" expect_sha="${3:-}"
  curl --proto '=https' --max-redirs 0 -fsSL "$url" -o "$out" || {
    fail "pinned_fetch: download failed: $url"
  }
  if [[ -n "$expect_sha" ]]; then
    local actual_sha
    actual_sha=$(sha256sum "$out" | awk '{print $1}')
    if [[ "$actual_sha" != "$expect_sha" ]]; then
      rm -f "$out"
      fail "pinned_fetch: sha256 mismatch for $url (expected $expect_sha, got $actual_sha) — upstream tampered or you need to bump the pin"
    fi
    log "pinned_fetch: sha256 verified for $(basename "$out")"
  else
    log "pinned_fetch: $(basename "$out") fetched (tag-pinned, sha256 NOT verified — set the *_SHA env to harden)"
  fi
}
NODE_HOST=${NODE_HOST:-0.0.0.0}
# 1337 since wave-13 (2026-05-21). Pre-wave default was 8443, which is the
# canonical HTTPS-alt port and the first thing every bot probes after 443.
# 1337 stays out of standard scanner profiles AND frees 8443 for actual
# user-protocol bindings (xray-on-8443 is a common Cloudflare-friendly
# fallback). Pre-wave installs are NOT migrated automatically — their
# node.address in DB is still :8443 and the systemd unit is still :8443.
# Operators on existing nodes can either leave as-is or re-bootstrap with
# `--reset --port 1337` to align with the new default.
NODE_PORT=${NODE_PORT:-1337}

PROTOCOL=""
PAYLOAD=""
PANEL_URL=""
BOOTSTRAP_TOKEN=""
RESET=0
UNINSTALL=0
# Slice S7 — UFW lock-down. When set, only this IP/CIDR (or comma-list)
# is allowed to reach :NODE_PORT. Without it the mTLS port is open to the
# whole internet — mTLS rejects everyone, but bots still spend our CPU on
# TLS handshakes and our agent leaks "I'm Iceslab" via the cert SAN.
PANEL_IP=""

# Hysteria 2 server config (only used with --protocol hysteria). When DOMAIN
# is given, the script writes /etc/hysteria/config.yaml + a hysteria systemd
# unit and starts the server — admin gets a fully-configured node from one
# command, no manual SSH editing.
HY_DOMAIN=""
HY_EMAIL=""
HY_MASQUERADE_URL="https://www.bing.com/"
HY_OBFS_PASSWORD=""
# Slice 31.5 — port-hopping. iptables NAT-REDIRECT for a UDP port range so
# clients can rotate destination ports per connection (mport=START-END in
# the URI). Defeats RU TSPU / IR / CN fixed-port UDP/443 throttle. The
# default range is wide enough to give clients lots of room without
# colliding with common service ports. Admin can narrow / widen via flag.
# The range here must be a SUPERSET of any per-profile range emitted in
# the panel — otherwise the panel-emitted ports rotate outside the
# iptables redirect and never reach hysteria.
HY_PORT_RANGE="20000-50000"

# Xray REALITY inbound params (only used with --protocol xray). When all the
# required ones are passed, they're written into /etc/iceslab-node/env so
# the node-agent's xray adapter spawns a working REALITY listener at startup.
# Without these flags the Xray adapter stays disabled until the admin edits
# the env file manually (slice 24 will auto-push these from the panel).
XR_PRIVATE_KEY=""
XR_PUBLIC_KEY=""
XR_SHORT_IDS=""
XR_SERVER_NAMES="www.cloudflare.com"
XR_DEST="www.cloudflare.com:443"
XR_PORT="443"

# Resolve a payload value: if it starts with "@", treat the rest as a path
# and read the file content. Otherwise return as-is. Mirrors curl's `-d @file`
# convention. Critical for long payloads — Linux TTY canonical-mode buffer
# truncates pastes at 4096 bytes, so anything pasted directly into the
# terminal (or via `--payload "..."` with the user shell-pasting into the
# command line) gets cut. File-backed payload sidesteps the TTY entirely.
# Wipe everything install-iceslab-node.sh creates: systemd unit, binary, source
# checkout, env dir, UFW allow-rule for the mTLS port, AND the per-
# protocol config the script generates (hysteria/xray service config).
# We deliberately keep upstream binaries (the `hysteria` / `xray` exes
# from their official installers) — only the config files, which are
# tied to the panel's domain/email/keys, get wiped so a re-install
# regenerates them cleanly. Idempotent — safe on a half-installed VPS.
do_uninstall() {
  log "Stopping iceslab-node service (if running)"
  systemctl stop iceslab-node 2>/dev/null || true
  systemctl disable iceslab-node 2>/dev/null || true

  log "Removing systemd unit + drop-ins"
  rm -f /etc/systemd/system/iceslab-node.service
  rm -rf /etc/systemd/system/iceslab-node.service.d

  log "Stopping + removing protocol-specific services + their generated configs"
  for svc in hysteria xray; do
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
  done
  rm -f /etc/systemd/system/hysteria.service
  rm -rf /etc/systemd/system/hysteria.service.d
  rm -f /etc/hysteria/config.yaml
  rm -f /etc/xray/config.json

  # Slice 31.5 — port-hopping cleanup. Stopping the systemd unit fires
  # its ExecStop= which calls `iceslab-hyhop down` to remove the
  # iptables rule. After that we can safely remove the script + unit.
  systemctl stop iceslab-hyhop 2>/dev/null || true
  systemctl disable iceslab-hyhop 2>/dev/null || true
  rm -f /etc/systemd/system/iceslab-hyhop.service
  rm -f /usr/local/bin/iceslab-hyhop
  systemctl daemon-reload || true

  log "Removing binary"
  rm -f /usr/local/bin/iceslab-node

  log "Removing env directory (/etc/iceslab-node)"
  rm -rf /etc/iceslab-node

  log "Removing source checkout ($ICESLAB_NODE_DIR)"
  rm -rf "$ICESLAB_NODE_DIR"

  if command -v ufw >/dev/null && ufw status | grep -q "${NODE_PORT}/tcp"; then
    log "Removing UFW allow rule for ${NODE_PORT}/tcp"
    ufw --force delete allow "${NODE_PORT}/tcp" >/dev/null || true
  fi
}

resolve_payload() {
  local value="$1"
  if [[ "$value" == @* ]]; then
    local path="${value#@}"
    [[ -r "$path" ]] || fail "Cannot read payload file: $path"
    # Strip any whitespace/newlines a careless save might leave in the file.
    tr -d '\n\r \t' < "$path"
  else
    printf '%s' "$value"
  fi
}

# Wave-14 #5: bootstrap token passed as `--bootstrap <tok>` ends up in
# /proc/<pid>/cmdline for the lifetime of the install — any unprivileged
# local process can grab it and (within the 15-min TTL) issue a full mTLS
# keypair against the panel for this node. Reading from a file avoids the
# argv exposure; same shape as resolve_payload's @file convention.
resolve_bootstrap() {
  local value="$1"
  [[ -r "$value" ]] || fail "Cannot read bootstrap-file: $value"
  tr -d '\n\r \t' < "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --protocol)      PROTOCOL="$2"; shift 2 ;;
    --payload)       PAYLOAD=$(resolve_payload "$2"); shift 2 ;;
    --payload-file)  PAYLOAD=$(resolve_payload "@$2"); shift 2 ;;
    --panel-url)     PANEL_URL="${2%/}"; shift 2 ;;
    # --bootstrap exposes the token in /proc/cmdline; prefer --bootstrap-file
    # in non-trusted environments (shared VPS, audit-logged hosts).
    --bootstrap)         BOOTSTRAP_TOKEN="$2"; shift 2 ;;
    --bootstrap-file)    BOOTSTRAP_TOKEN=$(resolve_bootstrap "$2"); shift 2 ;;
    --port)          NODE_PORT="$2"; shift 2 ;;
    # Hysteria 2 — auto-configure server (config.yaml + systemd unit)
    --hysteria-domain)         HY_DOMAIN="$2"; shift 2 ;;
    --hysteria-email)          HY_EMAIL="$2"; shift 2 ;;
    --hysteria-masquerade-url) HY_MASQUERADE_URL="$2"; shift 2 ;;
    --hysteria-obfs-password)  HY_OBFS_PASSWORD="$2"; shift 2 ;;
    # Slice 31.5 — port-hopping iptables redirect range. Accepts
    # `START-END` (hyphen). Pass empty string to disable port-hopping
    # on this node (then iptables stays untouched).
    --hysteria-port-range)     HY_PORT_RANGE="$2"; shift 2 ;;
    # Xray REALITY — pre-fill env so the adapter starts immediately
    --xray-reality-private-key)  XR_PRIVATE_KEY="$2"; shift 2 ;;
    --xray-reality-public-key)   XR_PUBLIC_KEY="$2"; shift 2 ;;
    --xray-reality-short-ids)    XR_SHORT_IDS="$2"; shift 2 ;;
    --xray-reality-server-names) XR_SERVER_NAMES="$2"; shift 2 ;;
    --xray-reality-dest)         XR_DEST="$2"; shift 2 ;;
    --xray-port)                 XR_PORT="$2"; shift 2 ;;
    # Re-installation flow on a VPS that already hosts a previous agent:
    #   --reset      → wipe prior state silently before installing
    #   --uninstall  → wipe prior state and exit (no install)
    # Without either flag, a detected prior install triggers an interactive
    # "overwrite? [y/N]" prompt; non-interactive runs (no tty) abort.
    --reset)         RESET=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    --panel-ip)      PANEL_IP="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

# ───── -1. Uninstall fast-path ─────
# Run BEFORE bootstrap-token redemption — otherwise `--uninstall` would
# pointlessly consume a one-shot bootstrap token.
if [[ $UNINSTALL -eq 1 ]]; then
  if [[ -f /etc/iceslab-node/env || -x /usr/local/bin/iceslab-node ]]; then
    log "Uninstalling previous iceslab-node …"
    do_uninstall
    log "✅ Uninstall complete. Rerun install-iceslab-node.sh to set up a fresh agent."
  else
    log "Nothing to uninstall — no prior iceslab-node found."
  fi
  exit 0
fi

# If both --panel-url and --bootstrap given, redeem the bootstrap token to
# fetch the full payload from panel over HTTP. This is the recommended flow
# — it sidesteps the 4 KB TTY paste limit because the long payload travels
# over a plain HTTP body, not through the user's shell.
if [[ -n "$BOOTSTRAP_TOKEN" && -n "$PANEL_URL" ]]; then
  log "Redeeming bootstrap token at $PANEL_URL"
  TMP_PAYLOAD=$(mktemp)
  # Cycle #6 fix 2026-05-12 — was `curl -f ... || echo 000`. `-f` makes curl
  # exit non-zero on HTTP 4xx/5xx, which triggered the `|| echo 000` and
  # appended "000" to whatever http_code -w already wrote → "410" became
  # "410000" and missed the case-410 branch, falling through to "*" with
  # the misleading "Unexpected HTTP 410000" message. Drop -f so curl exits 0
  # on every reply where the response was actually parsed (we use http_code
  # to distinguish); separate || fallback covers only the network-down
  # case where curl couldn't connect at all.
  # --proto =https forbids the URL from being http://; --max-redirs 0
  # blocks an attacker-controlled redirect that would otherwise let
  # `--panel-url http://attacker/` 302 to the real panel and MITM the
  # mTLS keypair handoff. Operator who genuinely needs to hit a panel
  # over plain HTTP for a one-off test can pass --panel-url-allow-http
  # (not implemented; revisit if anyone asks).
  case "$PANEL_URL" in
    https://*) ;;
    *) fail "--panel-url must start with https:// (got: $PANEL_URL)" ;;
  esac
  HTTP_CODE=$(curl --proto '=https' --max-redirs 0 -sS -o "$TMP_PAYLOAD" -w '%{http_code}' \
    "$PANEL_URL/api/internal/bootstrap/$BOOTSTRAP_TOKEN" 2>/dev/null) || HTTP_CODE="000"
  case "$HTTP_CODE" in
    200) PAYLOAD=$(tr -d '\n\r \t' < "$TMP_PAYLOAD"); rm -f "$TMP_PAYLOAD" ;;
    404) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token not found at $PANEL_URL — typo or expired+purged" ;;
    410) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token already consumed or expired — issue a fresh one in the panel UI" ;;
    000) rm -f "$TMP_PAYLOAD"; fail "Cannot reach panel at $PANEL_URL — check the URL, TLS cert, firewall" ;;
    *)   rm -f "$TMP_PAYLOAD"; fail "Unexpected HTTP $HTTP_CODE from panel — see panel logs" ;;
  esac
  log "Bootstrap successful — fetched ${#PAYLOAD} bytes of payload"
elif [[ -n "$BOOTSTRAP_TOKEN" || -n "$PANEL_URL" ]]; then
  fail "--panel-url and --bootstrap must be passed TOGETHER (got only one)"
fi

prompt_protocol() {
  cat <<'EOF'

Pick a protocol for this node (one protocol per VPS is the recommended
pattern — resource isolation, simpler firewall):

  1) Xray          VLESS+REALITY+Vision (TCP/443, raw/xhttp/ws/grpc transports)
  2) Hysteria 2    UDP/443, QUIC, Brutal CC — best throughput on lossy links
  3) AmneziaWG     DPI-resistant WireGuard fork (needs kernel module + DKMS)
  4) NaiveProxy    Caddy fork with klzgrad/forwardproxy@naive (≥2 GB RAM build)
  5) Shadowsocks   SS2022 multi-user via xray-core (TCP+UDP/443, no separate bin)
  6) MTProto       Telegram-only proxy via 9seconds/mtg (Fake-TLS over TCP/443)
  7) Mieru         Stealth proxy via enfein/mieru (mita server, TCP+UDP)

EOF
  local choice
  while true; do
    read -rp "Select [1-7]: " choice </dev/tty || fail "no /dev/tty — pass --protocol explicitly"
    case "$choice" in
      1) PROTOCOL=xray;        break ;;
      2) PROTOCOL=hysteria;    break ;;
      3) PROTOCOL=amneziawg;   break ;;
      4) PROTOCOL=naive;       break ;;
      5) PROTOCOL=shadowsocks; break ;;
      6) PROTOCOL=mtproto;     break ;;
      7) PROTOCOL=mieru;       break ;;
      *) echo "  → invalid choice '$choice'; enter 1-7." ;;
    esac
  done
  log "Selected protocol: $PROTOCOL"
}

prompt_payload() {
  cat <<'EOF'

The panel issued a one-time base64 payload when you created this Node — it
contains the mTLS keypair. Find it in the panel UI: Nodes → Create node →
the modal that pops up after submit.

Two ways to enter it here:

  1. Paste the base64 string directly. WORKS ONLY for payloads under
     ~4 KB — Linux TTY truncates longer pastes at 4096 bytes. Real
     payloads are ~6-7 KB, so this almost never works.

  2. Save the payload to a file first (download via panel UI button, or
     scp from your laptop, or `cat > /tmp/payload.b64` if your terminal
     allows). Then enter `@/path/to/file` here — the script reads the
     file content directly without any TTY buffering.

EOF
  local input
  read -rp "Payload (or @/path/to/file): " input </dev/tty || fail "no /dev/tty — pass --payload explicitly"
  PAYLOAD=$(resolve_payload "$input")
  if [[ -z "$PAYLOAD" ]]; then
    fail "empty payload"
  fi
  # Sanity-check length: real payload is base64 of a ~3 KB JSON, so ≥4 KB
  # base64. Anything shorter is almost certainly truncated and we'll fail
  # later with a confusing JSON-decode error. Loudly warn now.
  if [[ ${#PAYLOAD} -lt 4000 ]]; then
    warn "payload is only ${#PAYLOAD} chars — typical payloads are 6-7 KB."
    warn "If you pasted directly into the terminal, you likely hit the 4096-byte"
    warn "TTY paste limit. Re-run with --payload @/path/to/file for the full thing."
  fi
}

# ───── 0. Existing-install handling ─────
# Detect a prior installation. The env file is the canonical marker — if
# it's there, the agent has at least been bootstrapped against *some*
# panel before. Re-using it against a different (or freshly-rebuilt)
# panel is the #1 source of "panel can't reach node" support tickets,
# because the old server cert won't validate against the new panel CA.
EXISTING_INSTALL=0
if [[ -f /etc/iceslab-node/env || -x /usr/local/bin/iceslab-node ]]; then
  EXISTING_INSTALL=1
fi

if [[ $EXISTING_INSTALL -eq 1 ]]; then
  if [[ $RESET -eq 1 ]]; then
    log "--reset given — wiping previous installation"
    do_uninstall
  elif [[ -e /dev/tty ]]; then
    warn "Detected previous iceslab-node install on this VPS."
    warn "Re-installing against a different panel without wiping state will"
    warn "cause mTLS verification to fail (old server cert vs new panel CA)."
    # Cycle #6 reality-check 2026-05-12 — `read -rp "..." ans </dev/tty`
    # silently lost the keypress in the `bash <(curl ...)` process-substitution
    # flow (the prompt printed but the subsequent read returned empty, hitting
    # the `*` branch with "Aborted by user" even though `y` was typed). Splitting
    # the prompt print and the read fixes it — `read` then has /dev/tty as a
    # proper terminal handle without the prompt-print racing the input side.
    printf '\033[1;33mWipe previous installation and continue? [y/N]:\033[0m '
    if ! read -r ans </dev/tty; then
      ans=""
    fi
    case "${ans,,}" in
      y|yes) do_uninstall ;;
      *)     fail "Aborted by user. Pass --reset to skip this prompt, or --uninstall to remove without re-installing." ;;
    esac
  else
    fail "Previous install detected and no /dev/tty for prompt. Pass --reset to overwrite or --uninstall to remove."
  fi
fi

case "$PROTOCOL" in
  hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru) ;;
  "")
    if [[ -e /dev/tty ]]; then
      prompt_protocol
    else
      fail "Pass --protocol hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru (no /dev/tty for interactive menu)"
    fi
    ;;
  *)  fail "Unknown protocol: $PROTOCOL (valid: hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru)" ;;
esac

step "Prerequisites"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported here" ;;
esac
ok "$PRETTY_NAME · protocol=$PROTOCOL"

# RAM / swap check — same insurance as install-iceslab.sh. Go build itself is
# light, but the protocol bootstrap scripts (xcaddy compile for Naive, DKMS
# build for AmneziaWG) can spike past 1 GB. Tiny VPS without swap gets killed.
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
CURRENT_SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
ok "RAM: ${TOTAL_RAM_MB} MB · swap: ${CURRENT_SWAP_MB} MB"

if [[ "$TOTAL_RAM_MB" -lt 1500 && "$CURRENT_SWAP_MB" -lt 500 ]]; then
  if [[ "${SKIP_SWAP:-0}" == "1" ]]; then
    warn "RAM=${TOTAL_RAM_MB} MB, no swap; protocol bootstrap may OOM (Naive xcaddy especially)."
  else
    SWAP_SIZE=${SWAP_SIZE_MB:-2048}
    log "Creating ${SWAP_SIZE} MB swap at /swapfile"
    if ! fallocate -l "${SWAP_SIZE}M" /swapfile 2>/dev/null; then
      dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE}" status=none
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q "^/swapfile" /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10 >/dev/null
    ok "swap online: $(free -h | awk '/^Swap:/ {print $2}')"
  fi
fi

# ───── 2a. OS upgrade ─────
# Pull pending security + package updates before laying down node-agent.
# Opt-in: dist-upgrade is intrusive on alpha (reboots kernel, restarts sshd).
# Pass DO_OS_UPGRADE=1 if you actually want it; default is now off.
if [[ "${DO_OS_UPGRADE:-0}" == "1" ]]; then
  log "Upgrading OS packages (apt-get update + dist-upgrade)"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" dist-upgrade -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" autoremove -y
fi

# ───── 2b. Prereqs ─────
# `unzip` is required by the XTLS/Xray-install bootstrap (step 4 for xray
# and shadowsocks). When apt doesn't have unzip preinstalled, that script
# tries to install it itself and fails with "Installation of unzip failed,
# please check your network" on fresh Ubuntu 24.04 minimal images. Pulling
# it eagerly here makes the xray bootstrap a no-op for the unzip dep.
#
# Force `apt-get update` first even when DO_OS_UPGRADE=0. Ubuntu cloud
# images ship with a stale apt list (the cache from the image-build day),
# and `apt install <new package>` fails with "Unable to locate package"
# until the list is refreshed. Refresh is cheap (~3-5 sec on a fresh
# VPS) so always-on is the right default.
log "Refreshing apt package list"
"${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
log "Installing apt prereqs"
"${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y git curl ca-certificates ufw unzip

# ───── 3. Go ─────
NEED_GO=true
if command -v go >/dev/null; then
  CUR=$(go version | awk '{print $3}' | sed 's/^go//')
  if [[ "$(printf '%s\n' "1.22" "$CUR" | sort -V | head -1)" == "1.22" ]]; then
    NEED_GO=false
  fi
fi
if $NEED_GO; then
  GO_VERSION=${GO_VERSION:-1.23.4}
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in
    amd64) GO_ARCH=amd64 ;;
    arm64) GO_ARCH=arm64 ;;
    *) fail "Unsupported arch: $ARCH" ;;
  esac
  log "Installing Go $GO_VERSION"
  TMPDL=$(mktemp -d)
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o "${TMPDL}/go.tar.gz"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "${TMPDL}/go.tar.gz"
  rm -rf "$TMPDL"
fi
export PATH=/usr/local/go/bin:$PATH

# Persist `go` in PATH for future SSH sessions — symlink into /usr/local/bin
# (which is on every distro's default PATH) so admins can rebuild the agent
# manually after a `git pull` without having to re-run install-iceslab-node.sh.
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

step "Source checkout (${ICESLAB_NODE_REF})"
if [[ ! -d "$ICESLAB_NODE_DIR/.git" ]]; then
  log "Cloning $ICESLAB_NODE_REPO@$ICESLAB_NODE_REF"
  git clone --depth 1 --branch "$ICESLAB_NODE_REF" "$ICESLAB_NODE_REPO" "$ICESLAB_NODE_DIR"
else
  log "Updating existing checkout"
  # Refuse to nuke an operator-edited checkout silently. See the same
  # guard in install-iceslab.sh for the full rationale.
  if ! git -C "$ICESLAB_NODE_DIR" diff --quiet HEAD -- 2>/dev/null ||
     ! git -C "$ICESLAB_NODE_DIR" diff --quiet --cached HEAD -- 2>/dev/null; then
    if [[ "${FORCE_RESET:-0}" != "1" ]]; then
      fail "Checkout at $ICESLAB_NODE_DIR has uncommitted changes. Re-run with FORCE_RESET=1 to discard them, or stash before retrying."
    fi
    log "FORCE_RESET=1 — discarding local edits in $ICESLAB_NODE_DIR"
  fi
  git -C "$ICESLAB_NODE_DIR" fetch --depth 1 origin "$ICESLAB_NODE_REF"
  git -C "$ICESLAB_NODE_DIR" reset --hard "origin/$ICESLAB_NODE_REF" || true
fi

# Wave-14 #4: see install-iceslab.sh for the threat model. Pin SHA for prod.
if [[ -n "${ICESLAB_NODE_REF_SHA:-}" ]]; then
  actual_sha=$(git -C "$ICESLAB_NODE_DIR" rev-parse HEAD)
  if [[ "$actual_sha" != "$ICESLAB_NODE_REF_SHA" ]]; then
    fail "ICESLAB_NODE_REF_SHA mismatch: tag $ICESLAB_NODE_REF resolved to $actual_sha, expected $ICESLAB_NODE_REF_SHA. Tag may have been re-pointed upstream — abort."
  fi
  ok "commit SHA verified ($actual_sha)"
fi

step "Build node-agent (Go, static)"
cd "$ICESLAB_NODE_DIR/apps/node"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/iceslab-node .
chmod +x /usr/local/bin/iceslab-node
ok "built /usr/local/bin/iceslab-node ($(stat -c %s /usr/local/bin/iceslab-node) bytes)"

step "Protocol bootstrap (${PROTOCOL})"
case "$PROTOCOL" in
  hysteria)
    if ! command -v hysteria >/dev/null; then
      log "Installing hysteria via pinned apernet/hysteria@$HYSTERIA_INSTALLER_REF"
      HY_TMP=$(mktemp)
      pinned_fetch \
        "https://raw.githubusercontent.com/apernet/hysteria/${HYSTERIA_INSTALLER_REF}/scripts/install_server.sh" \
        "$HY_TMP" \
        "$HYSTERIA_INSTALLER_SHA"
      if [[ -n "$HYSTERIA_VERSION" ]]; then
        bash "$HY_TMP" --version "$HYSTERIA_VERSION"
      else
        bash "$HY_TMP"
      fi
      rm -f "$HY_TMP"
    else
      log "hysteria already present: $(hysteria version | head -1)"
    fi
    PROTO_BINARY=$(command -v hysteria)
    PROTO_CONFIG=/etc/hysteria/config.yaml
    ;;
  xray)
    if ! command -v xray >/dev/null; then
      log "Installing xray via pinned XTLS/Xray-install@$XRAY_INSTALLER_REF"
      XR_TMP=$(mktemp)
      pinned_fetch \
        "https://raw.githubusercontent.com/XTLS/Xray-install/${XRAY_INSTALLER_REF}/install-release.sh" \
        "$XR_TMP" \
        "$XRAY_INSTALLER_SHA"
      # XTLS/Xray-install's install-release.sh takes the operation as its
      # first positional arg ('install', 'install-geodata', 'remove', etc).
      # An earlier copy of this line had `@ install` — the stray `@` made
      # the installer print "unknown option -- -" and abort. Just pass the
      # operation directly.
      bash "$XR_TMP" install
      rm -f "$XR_TMP"
    else
      log "xray already present: $(xray version | head -1)"
    fi
    # XTLS installer creates its own xray.service that conflicts with our
    # node-agent's subprocess management. Disable it — iceslab-node owns xray.
    systemctl stop xray.service  >/dev/null 2>&1 || true
    systemctl disable xray.service >/dev/null 2>&1 || true
    log "XTLS xray.service disabled — iceslab-node manages xray directly"
    PROTO_BINARY=$(command -v xray)
    PROTO_CONFIG=/usr/local/etc/xray/config.json
    ;;
  amneziawg)
    log "Chaining bootstrap-amneziawg.sh"
    bash "$ICESLAB_NODE_DIR/apps/node/scripts/bootstrap-amneziawg.sh"
    PROTO_BINARY=""
    PROTO_CONFIG=""
    ;;
  naive)
    log "Chaining bootstrap-naive.sh"
    bash "$ICESLAB_NODE_DIR/apps/node/scripts/bootstrap-naive.sh"
    PROTO_BINARY=/usr/local/bin/caddy-naive
    PROTO_CONFIG=/etc/caddy/Caddyfile
    ;;
  shadowsocks)
    # SS2022 multi-user runs INSIDE xray-core (slice 24d). No separate binary.
    # Reuse the xray install path; the SS adapter on the node-agent shells out
    # to its own xray-api inbound on 127.0.0.1:8081 (one above the VLESS
    # adapter's :8080 to avoid collision when both adapters live on one node).
    if ! command -v xray >/dev/null; then
      log "Installing xray (SS2022 runs inside xray-core) via pinned XTLS/Xray-install@$XRAY_INSTALLER_REF"
      XR_TMP=$(mktemp)
      pinned_fetch \
        "https://raw.githubusercontent.com/XTLS/Xray-install/${XRAY_INSTALLER_REF}/install-release.sh" \
        "$XR_TMP" \
        "$XRAY_INSTALLER_SHA"
      # XTLS/Xray-install's install-release.sh takes the operation as its
      # first positional arg ('install', 'install-geodata', 'remove', etc).
      # An earlier copy of this line had `@ install` — the stray `@` made
      # the installer print "unknown option -- -" and abort. Just pass the
      # operation directly.
      bash "$XR_TMP" install
      rm -f "$XR_TMP"
    else
      log "xray already present: $(xray version | head -1)"
    fi
    systemctl stop xray.service  >/dev/null 2>&1 || true
    systemctl disable xray.service >/dev/null 2>&1 || true
    log "XTLS xray.service disabled — iceslab-node manages xray directly"
    PROTO_BINARY=$(command -v xray)
    PROTO_CONFIG=/etc/xray/shadowsocks.json
    ;;
  mtproto)
    log "Chaining bootstrap-mtg.sh"
    bash "$ICESLAB_NODE_DIR/apps/node/scripts/bootstrap-mtg.sh"
    PROTO_BINARY=/usr/local/bin/mtg
    PROTO_CONFIG=/etc/mtg/config.toml
    ;;
  mieru)
    log "Chaining bootstrap-mieru.sh"
    bash "$ICESLAB_NODE_DIR/apps/node/scripts/bootstrap-mieru.sh"
    PROTO_BINARY=/usr/local/bin/mita
    PROTO_CONFIG=/etc/mita/server.json
    ;;
esac

step "Environment file (/etc/iceslab-node/env)"
ENV_DIR=/etc/iceslab-node
mkdir -p "$ENV_DIR"

# ProtectSystem=strict in our systemd unit makes /etc read-only except for
# explicit ReadWritePaths. ReadWritePaths can't *create* directories, only
# permit writes inside existing ones — so we pre-create every per-protocol
# config dir here, even if the protocol isn't installed on this node.
mkdir -p /etc/xray /etc/hysteria /etc/amnezia/amneziawg /etc/caddy /etc/mtg /etc/mita
ENV_FILE="$ENV_DIR/env"

# Honour --payload only if the env file doesn't exist OR the user passed one.
if [[ -n "$PAYLOAD" || ! -f "$ENV_FILE" ]]; then
  if [[ -z "$PAYLOAD" ]]; then
    if [[ -e /dev/tty ]]; then
      prompt_payload
    else
      fail "First-time install needs --payload <base64-blob> from panel (no /dev/tty for interactive prompt)"
    fi
  fi
  log "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
NODE_PAYLOAD=${PAYLOAD}
NODE_HOST=${NODE_HOST}
NODE_PORT=${NODE_PORT}
EOF
  case "$PROTOCOL" in
    hysteria)
      cat >> "$ENV_FILE" <<EOF
HYSTERIA_BINARY=${PROTO_BINARY}
HYSTERIA_CONFIG=${PROTO_CONFIG}
HYSTERIA_AUTH_HOST=127.0.0.1
HYSTERIA_AUTH_PORT=9000
EOF
      # Pass domain + email through to the agent so subsequent ApplyInbound
      # pushes can rewrite the Hysteria config without losing identity.
      # Without these, the agent's hysteria adapter falls back to defaults
      # ("your.domain.net") on the next config write — exactly the bug we
      # just chased on the first ice-hys2-test install.
      if [[ -n "$HY_DOMAIN" ]]; then
        echo "HYSTERIA_HOSTNAME=${HY_DOMAIN}" >> "$ENV_FILE"
      fi
      if [[ -n "$HY_EMAIL" ]]; then
        echo "HYSTERIA_ACME_EMAIL=${HY_EMAIL}" >> "$ENV_FILE"
      fi
      # Tell the agent we're delegating hysteria's lifecycle to systemd
      # (the install just wrote /etc/systemd/system/hysteria.service).
      # Without this, the agent's adapter assumes "spawn-mode" and tries
      # to fork its own hysteria process — which then fights the systemd-
      # managed copy for :443/udp and dies with "address already in use".
      echo "HYSTERIA_SERVICE_UNIT=hysteria" >> "$ENV_FILE"
      # Cycle #6 reality-check 2026-05-12 — traffic API endpoint. Without
      # this hysteria-server doesn't expose per-user uplink/downlink and
      # the panel UI is stuck on "0 B today" for every Hysteria node even
      # under multi-MiB load. Generate a random secret here so adapter
      # (poller) and hysteria-server (validator) share the same value;
      # bind loopback-only so the endpoint is unreachable from outside.
      HYSTERIA_STATS_SECRET=$(openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 48)
      {
        echo "HYSTERIA_STATS_LISTEN=127.0.0.1:9999"
        echo "HYSTERIA_STATS_SECRET=${HYSTERIA_STATS_SECRET}"
      } >> "$ENV_FILE"
      ;;
    xray)
      cat >> "$ENV_FILE" <<EOF
XRAY_BINARY=${PROTO_BINARY}
XRAY_CONFIG=${PROTO_CONFIG}
EOF
      if [[ -n "$XR_PRIVATE_KEY" && -n "$XR_SHORT_IDS" ]]; then
        cat >> "$ENV_FILE" <<EOF
XRAY_REALITY_PRIVATE_KEY=${XR_PRIVATE_KEY}
XRAY_REALITY_SHORT_IDS=${XR_SHORT_IDS}
XRAY_REALITY_SERVER_NAMES=${XR_SERVER_NAMES}
XRAY_REALITY_DEST=${XR_DEST}
XRAY_PORT=${XR_PORT}
EOF
        log "Xray REALITY env populated (port=${XR_PORT}, sni=${XR_SERVER_NAMES})"
      else
        cat >> "$ENV_FILE" <<EOF
# Fill in once you create an Xray inbound in the panel:
# XRAY_REALITY_PRIVATE_KEY=
# XRAY_REALITY_SHORT_IDS=
# XRAY_REALITY_SERVER_NAMES=
# XRAY_REALITY_DEST=www.cloudflare.com:443
# XRAY_PORT=443
EOF
      fi
      ;;
    naive)
      cat >> "$ENV_FILE" <<EOF
NAIVE_BINARY=${PROTO_BINARY}
NAIVE_CONFIG=${PROTO_CONFIG}
EOF
      ;;
    shadowsocks)
      # SS2022 multi-user is driven by xray-core; the SS adapter spawns its own
      # api-inbound at :8081 separate from the VLESS adapter at :8080.
      cat >> "$ENV_FILE" <<EOF
XRAY_BINARY=${PROTO_BINARY}
SHADOWSOCKS_CONFIG=${PROTO_CONFIG}
# Cipher (default 2022-blake3-aes-256-gcm). Override only if you have a
# legacy-client compatibility need.
# SHADOWSOCKS_METHOD=2022-blake3-aes-256-gcm
EOF
      ;;
    mtproto)
      cat >> "$ENV_FILE" <<EOF
MTG_BINARY=${PROTO_BINARY}
MTG_CONFIG=${PROTO_CONFIG}
MTG_PORT=443
MTG_STATS_PORT=3129
# Fake-TLS masquerade domain — must be a real, popular HTTPS host. Filled
# in via panel UI when you create the MTProto inbound; safe default below.
# MTG_DOMAIN=www.cloudflare.com
EOF
      ;;
    mieru)
      cat >> "$ENV_FILE" <<EOF
MITA_BINARY=${PROTO_BINARY}
MITA_CONFIG=${PROTO_CONFIG}
EOF
      ;;
  esac
  chmod 600 "$ENV_FILE"
else
  log "$ENV_FILE exists — keeping current payload (pass --payload to overwrite)"
fi

step "Firewall (ufw)"
# Allow SSH FIRST so enabling ufw can't lock us out, then per-protocol ports,
# then flip defaults to deny + enable. Skip with SKIP_FIREWALL=1.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  log "ufw: SSH + panel-mTLS:$NODE_PORT + protocol-specific"
  ufw allow 22/tcp                       >/dev/null 2>&1 || true
  # Slice S7 — restrict mTLS port to the panel's IP if --panel-ip given,
  # otherwise (--panel-ip not set) fall back to world-open with a loud warn.
  # Resolving --panel-url's host into a candidate IP would help, but DNS
  # changes (CF rotations, panel migrations) would silently break the
  # control plane — we'd rather make the operator type it explicitly.
  if [[ -n "$PANEL_IP" ]]; then
    log "Restricting :${NODE_PORT}/tcp to PANEL_IP=$PANEL_IP (use comma-list for multiple)"
    IFS=',' read -ra _PANEL_IPS <<< "$PANEL_IP"
    for ip in "${_PANEL_IPS[@]}"; do
      ufw allow from "${ip// /}" to any port "$NODE_PORT" proto tcp >/dev/null 2>&1 || true
    done
    unset _PANEL_IPS
  else
    warn "no --panel-ip given — mTLS port :${NODE_PORT}/tcp opened to the WORLD."
    warn "mTLS still rejects unknown clients, but you waste CPU on bot handshakes"
    warn "and leak 'this is Iceslab' via the server cert SAN. Pass --panel-ip <ip>"
    warn "next time (panel public IP) to lock it down. You can also fix it now:"
    warn "  ufw delete allow ${NODE_PORT}/tcp; ufw allow from <panel-ip> to any port ${NODE_PORT} proto tcp"
    ufw allow "${NODE_PORT}/tcp"           >/dev/null 2>&1 || true
  fi
  case "$PROTOCOL" in
    hysteria)
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ufw allow 80/tcp                   >/dev/null 2>&1 || true  # ACME HTTP-01 (one-time)
      ;;
    xray)
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ;;
    amneziawg)
      # Per upstream amnezia.org docs: pick a port BELOW 9999 (some ISPs
      # block UDP on high ports, and 51820 is the well-known WireGuard
      # default that DPI specifically targets). We pre-open 443 (HTTPS-
      # masquerade) and 1234 (recommended by upstream as an example
      # low-port alternative). Admin can pick either in the panel Profile
      # UI; or open another port manually if they prefer something else.
      # 51820 deliberately NOT opened — operators who really need it can
      # `ufw allow 51820/udp` themselves. Caught live cycle #6 2026-05-12.
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ufw allow 1234/udp                 >/dev/null 2>&1 || true
      # UFW defaults DEFAULT_FORWARD_POLICY=DROP, but AmneziaWG is a routed
      # VPN — packets enter on awg0 and must FORWARD to the WAN. Without
      # this flip clients reach "Connected" and handshake completes, but
      # the FORWARD chain silently drops their decrypted traffic.
      # Caught live 2026-05-13 on a production node.
      if [[ -f /etc/default/ufw ]]; then
        sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
      fi
      ufw default allow routed           >/dev/null 2>&1 || true
      ;;
    naive)
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 80/tcp                   >/dev/null 2>&1 || true  # Caddy ACME
      ;;
    shadowsocks)
      # SS2022 listens on TCP+UDP; UDP needed for relay (DNS/QUIC/realtime).
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ;;
    mtproto)
      # mtg Fake-TLS handshake mimics HTTPS — TCP/443 is the canonical port.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ;;
    mieru)
      # mita supports either TCP or UDP transport per port-binding entry.
      # Allow both; firewall extras can be tightened post-install.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ;;
  esac
  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable         >/dev/null
  log "ufw status: $(ufw status | head -1)"
fi

step "systemd unit + start"
UNIT=/etc/systemd/system/iceslab-node.service
log "Installing systemd unit at $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=Iceslab node-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/iceslab-node
Restart=always
RestartSec=5
# Slice 38 — heartbeat self-destruct exits with code 42 to signal "panel
# disowned this node, don't restart me." Any other exit (crash, panic,
# ENV typo, transient OOM-kill) goes through Restart=always as before.
RestartPreventExitStatus=42
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
# /run is needed for ufw's lockfile (/run/ufw.lock) — without it the agent's
# firewall.Allow() helper crashes with "Read-only file system" because
# ProtectSystem=strict forbids /run writes by default. /run/xtables.lock
# matters too — iptables uses it from awg-quick PostUp.
# /etc/iptables/ for netfilter-persistent users (rules.v4 rewrites).
# Caught live 2026-05-13 on a production node after fresh install.
ReadWritePaths=-/var/log -/etc/iceslab-node -/etc/hysteria -/etc/xray -/usr/local/etc/xray -/etc/amnezia/amneziawg -/etc/caddy -/etc/mtg -/etc/mita -/var/lib/mita -/run -/etc/iptables
PrivateTmp=true

# Journald log limits — without these a node running for months can balloon
# /var/log/journal toward the disk-fill threshold. Cap roughly at ~50 MB
# total for this unit, age out older entries first.
LogRateLimitIntervalSec=30s
LogRateLimitBurst=10000

[Install]
WantedBy=multi-user.target
EOF

# Cap journald disk use globally to keep small VPS images alive.
JOURNALD_DROPIN=/etc/systemd/journald.conf.d/iceslab-cap.conf
mkdir -p "$(dirname "$JOURNALD_DROPIN")"
if [[ ! -f "$JOURNALD_DROPIN" ]]; then
  log "Capping journald disk use at 200 MB (drop-in $JOURNALD_DROPIN)"
  cat > "$JOURNALD_DROPIN" <<'EOF'
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
MaxRetentionSec=2week
EOF
  systemctl restart systemd-journald
fi

systemctl daemon-reload
systemctl enable iceslab-node.service
systemctl restart iceslab-node.service

# ───── 9b. Hysteria server config (auto-configure when domain given) ─────
# When admin passes --hysteria-domain + --hysteria-email, we lay down a full
# Hysteria 2 server config and systemd unit. Without this, the admin would
# have to SSH in and write /etc/hysteria/config.yaml by hand after running
# install-iceslab-node.sh — caught during the 2026-05-06 VPS test as a friction
# point. Skipped silently if either flag is missing or if the protocol
# isn't hysteria.
if [[ "$PROTOCOL" == "hysteria" && -n "$HY_DOMAIN" && -n "$HY_EMAIL" ]]; then
  HY_CONFIG=/etc/hysteria/config.yaml

  # Cycle #6 reality-check (2026-05-12): the official get.hy2.sh script
  # that runs earlier in this installer writes a placeholder config.yaml
  # with `your.domain.net` / `your@email.com` BEFORE we get here. The
  # previous "skip if file exists" behaviour then kept that placeholder
  # and silently ignored the admin's --hysteria-domain / --hysteria-email
  # flags — hysteria came up trying to obtain a cert for `your.domain.net`
  # and crashlooped. Detect the placeholder pattern and overwrite when
  # we have real values to write; only skip when the existing config
  # already mentions OUR domain (genuine admin-customized state).
  SHOULD_WRITE_CFG=1
  if [[ -f "$HY_CONFIG" ]]; then
    if grep -q "${HY_DOMAIN}" "$HY_CONFIG"; then
      SHOULD_WRITE_CFG=0
      log "Hysteria config already mentions ${HY_DOMAIN} — keeping admin-customized state"
    else
      log "Hysteria config at $HY_CONFIG exists but doesn't reference ${HY_DOMAIN} (likely placeholder from get.hy2.sh) — overwriting"
    fi
  fi
  if [[ $SHOULD_WRITE_CFG -eq 1 ]]; then
    log "Writing Hysteria 2 server config at $HY_CONFIG (domain=$HY_DOMAIN)"
    {
      cat <<EOF
listen: :443

acme:
  domains:
    - ${HY_DOMAIN}
  email: ${HY_EMAIL}

auth:
  type: http
  http:
    url: http://127.0.0.1:9000/auth
    insecure: true

masquerade:
  type: proxy
  proxy:
    url: ${HY_MASQUERADE_URL}
    rewriteHost: true

bandwidth:
  up: 1 gbps
  down: 1 gbps

# Cycle #5 ground truth: clients (Hiddify iOS, NekoBox, Streisand) often
# negotiate up=0 with Brutal CC at session start, leading to "tunnel
# handshakes but tx=0, websites don't load". Forcing BBR here removes
# the dependency on a sane client-side bandwidth declaration. Clients
# that DO emit valid upmbps/downmbps via subscription URI still benefit
# from Brutal because we re-render this section on ApplyInbound from
# the panel.
ignoreClientBandwidth: true

# Cycle #6 traffic stats endpoint. Bind loopback-only so it isn't
# reachable from outside; the agent polls it from the same host with
# the matching secret from /etc/iceslab-node/env (HYSTERIA_STATS_SECRET).
# Without this block, the agent's GetStats returns zero counters and
# the panel UI shows "0 B today" for every Hysteria node.
trafficStats:
  listen: 127.0.0.1:9999
  secret: ${HYSTERIA_STATS_SECRET}
EOF
      if [[ -n "$HY_OBFS_PASSWORD" ]]; then
        cat <<EOF

obfs:
  type: salamander
  salamander:
    password: ${HY_OBFS_PASSWORD}
EOF
      fi
    } > "$HY_CONFIG"
    chmod 600 "$HY_CONFIG"
  fi

  # Also disable get.hy2.sh's own systemd unit so its placeholder config
  # never gets picked up by a parallel service. Our hysteria.service
  # below owns the runtime.
  systemctl disable --now hysteria-server.service 2>/dev/null || true
  systemctl disable --now hysteria-server@.service 2>/dev/null || true

  HY_UNIT=/etc/systemd/system/hysteria.service
  if [[ ! -f "$HY_UNIT" ]]; then
    log "Installing Hysteria 2 systemd unit at $HY_UNIT"
    cat > "$HY_UNIT" <<EOF
[Unit]
Description=Hysteria 2 server
After=network-online.target iceslab-node.service
Wants=network-online.target iceslab-node.service

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server -c ${HY_CONFIG}
Restart=always
RestartSec=5
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
  fi
  # ───── IPv6 sanity-check for hysteria's outbound resolver ─────
  # Cycle #5 finding: many VPS providers route IPv4 cleanly but leave IPv6
  # half-configured (AAAA records resolve, but the host can't actually reach
  # IPv6 destinations). Hysteria proxies a client-requested DNS name and
  # Go's net resolver tries IPv6 first by default — when AAAA wins, every
  # request times out at the v6 hop and the user sees "client connected
  # but YouTube doesn't load." Force IPv4 preference via gai.conf so the
  # libc resolver returns A records first; IPv6 still works if it works,
  # this just demotes it from the default winner.
  if ! grep -q '^precedence ::ffff:0:0/96  100' /etc/gai.conf 2>/dev/null; then
    log "Configuring /etc/gai.conf to prefer IPv4 for hysteria's outbound resolver"
    echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf
  fi

  systemctl enable hysteria.service >/dev/null 2>&1 || true
  systemctl restart hysteria.service
  log "Hysteria 2 started — first run will obtain the LE certificate via HTTP-01"

  # ───── Slice 31.5 — Hysteria port-hopping (iptables REDIRECT) ─────
  # We install a tiny up/down helper + systemd unit that owns a single
  # NAT-PREROUTING rule redirecting `udp --dport START:END → :443`. The
  # unit is `Type=oneshot RemainAfterExit=yes` with ExecStart=up and
  # ExecStop=down so `systemctl stop` cleanly tears the rule down. The
  # rule is also restored on every boot (WantedBy=multi-user.target).
  #
  # We only install when:
  #   1. PROTOCOL=hysteria   (port-hopping is hysteria-specific)
  #   2. HY_PORT_RANGE is non-empty (admin can pass "" to opt out)
  #   3. iptables is present on the system
  if [[ -n "$HY_PORT_RANGE" ]] && command -v iptables >/dev/null 2>&1; then
    # Validate format BEFORE we substitute the value into the generated
    # helper script — the script runs as root and a careless typo (or a
    # tampered upstream install pipeline) would otherwise get baked in
    # verbatim. Format: `START-END` where both are 1024..65535 and END>START.
    if ! [[ "$HY_PORT_RANGE" =~ ^([0-9]{4,5})-([0-9]{4,5})$ ]]; then
      fail "--hysteria-port-range must be START-END (1024..65535), got: $HY_PORT_RANGE"
    fi
    HY_PR_START="${BASH_REMATCH[1]}"
    HY_PR_END="${BASH_REMATCH[2]}"
    if (( HY_PR_START < 1024 || HY_PR_END > 65535 || HY_PR_END <= HY_PR_START )); then
      fail "--hysteria-port-range out of bounds: $HY_PORT_RANGE (need 1024<start<end<=65535)"
    fi
    # iptables takes the range as `START:END` (colon). The flag we accept
    # is `START-END` (hyphen) so it matches the URI form admins see.
    HY_RANGE_IPT="${HY_PR_START}:${HY_PR_END}"
    HY_LISTEN_PORT=443
    HYHOP_BIN=/usr/local/bin/iceslab-hyhop
    HYHOP_UNIT=/etc/systemd/system/iceslab-hyhop.service

    log "Installing port-hopping iptables redirect: udp ${HY_PORT_RANGE} → ${HY_LISTEN_PORT}"

    cat > "$HYHOP_BIN" <<EOF
#!/usr/bin/env bash
# Iceslab Hysteria 2 port-hopping helper. Managed by systemd unit
# iceslab-hyhop.service — do not edit by hand. To change the range,
# re-run install-iceslab-node.sh with --hysteria-port-range START-END.
set -euo pipefail
RANGE_IPT='${HY_RANGE_IPT}'
LISTEN_PORT=${HY_LISTEN_PORT}
case "\${1:-}" in
  up)
    iptables -t nat -C PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null \\
      || iptables -t nat -A PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT"
    if command -v ip6tables >/dev/null 2>&1; then
      ip6tables -t nat -C PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null \\
        || ip6tables -t nat -A PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" \\
        || true
    fi
    ;;
  down)
    iptables -t nat -D PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null || true
    if command -v ip6tables >/dev/null 2>&1; then
      ip6tables -t nat -D PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null || true
    fi
    ;;
  *)
    echo "usage: \$0 up|down" >&2
    exit 64
    ;;
esac
EOF
    chmod 755 "$HYHOP_BIN"

    cat > "$HYHOP_UNIT" <<EOF
[Unit]
Description=Iceslab Hysteria 2 port-hopping (UDP ${HY_PORT_RANGE} → :${HY_LISTEN_PORT})
After=network-online.target hysteria.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${HYHOP_BIN} up
ExecStop=${HYHOP_BIN} down

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable iceslab-hyhop.service >/dev/null 2>&1 || true
    systemctl restart iceslab-hyhop.service
    log "Port-hopping active. Profile-side range MUST be a subset of ${HY_PORT_RANGE}."
  else
    [[ -z "$HY_PORT_RANGE" ]] && log "Port-hopping disabled by --hysteria-port-range ''"
    command -v iptables >/dev/null 2>&1 || warn "iptables not installed — skipping port-hopping setup"
  fi
elif [[ "$PROTOCOL" == "hysteria" ]]; then
  warn "Hysteria server NOT auto-configured — pass --hysteria-domain <fqdn> --hysteria-email <addr> next time"
  warn "Or manually write /etc/hysteria/config.yaml + systemd unit (see Hysteria 2 upstream docs at v2.hysteria.network)"
fi

step "Wait for node-agent ready"
# Ask systemd directly (Cycle #6 fix): mTLS HTTPS server rejects probes
# without a client cert, so `curl /healthz` always reports "didn't respond"
# even when the agent is perfectly healthy.
READY=false
for i in $(seq 1 30); do
  if systemctl is-active --quiet iceslab-node 2>/dev/null; then
    if ! systemctl is-failed --quiet iceslab-node 2>/dev/null; then
      READY=true
      break
    fi
  fi
  sleep 1
done
if $READY; then
  ok "iceslab-node active in ${i}s — panel will poll over mTLS within ~30s"
else
  warn "iceslab-node did NOT reach active state — check:"
  warn "  systemctl status iceslab-node"
  warn "  journalctl -u iceslab-node -f"
fi

PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

# Final per-step duration (last step doesn't get one from the next step() call).
printf '\033[2m       step %d done in %s\033[0m\n' "$STEP_N" "$(elapsed_step)"

printf '\n'
printf '\033[1;32m──────────────────────────────────────────────────────────────\033[0m\n'
printf '\033[1;32m  ✓ Iceslab node-agent is up\033[0m  \033[2m(total %s)\033[0m\n' "$(elapsed_total)"
printf '\033[1;32m──────────────────────────────────────────────────────────────\033[0m\n'
printf '\n'
printf '  Protocol     %s\n' "$PROTOCOL"
printf '  Public IP    %s\n' "$PUBLIC_IP"
printf '  mTLS port    %s/tcp  (panel connects here)\n' "$NODE_PORT"
printf '  Env file     %s  (chmod 600)\n' "$ENV_FILE"
printf '\n'
printf '  Next:  panel UI → Nodes tab → status flips to "connected" in a few seconds\n'
printf '\n'
printf '  Logs       journalctl -u iceslab-node -f -o short-iso\n'
printf '  Restart    systemctl restart iceslab-node\n'
printf '  Status     systemctl status  iceslab-node\n'
printf '\n'
