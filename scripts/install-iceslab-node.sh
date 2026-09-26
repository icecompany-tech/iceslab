#!/usr/bin/env bash
# Iceslab node-agent one-command installer.
#
# What it does:
#   1. Verifies Go + git (installs them on Ubuntu/Debian if missing)
#   2. Clones repo into $ICESLAB_NODE_DIR (default /opt/iceslab-node)
#   3. Builds the static node-agent binary -> /usr/local/bin/iceslab-node
#   4. Writes /etc/iceslab-node/env with NODE_PAYLOAD and the install flags
#   5. Runs the bootstrap of every core the node gets (--engines, plus the
#      core of --protocol), the same apps/node/scripts/bootstrap-<core>.sh the
#      panel's "how to install" runs on a live node. Each one installs its core
#      and writes its own block of the env (and its unit, where it has one), so
#      the installer keeps no copy of any of that:
#        xray, shadowsocks            -> bootstrap-xray.sh (SS2022 runs in xray)
#        tuic, anytls, shadowtls      -> bootstrap-singbox.sh
#        hysteria                     -> bootstrap-hysteria.sh (+ hysteria.service)
#        amneziawg                    -> bootstrap-amneziawg.sh (DKMS module + tools)
#        naive                        -> bootstrap-naive.sh (xcaddy + plugin)
#        mtproto                      -> bootstrap-mtg.sh (9seconds/mtg)
#        mieru                        -> bootstrap-mieru.sh (enfein/mieru, mita.service)
#   6. Drops a systemd unit at /etc/systemd/system/iceslab-node.service
#   7. Enables + starts the service, waits for it to be active
#
# The cores are a set, none of them the main one (what the panel emits, one
# core too):
#   --engines xray,hysteria,singbox
# The order means nothing, and the set may be empty: with no --engines and no
# --protocol only the agent goes on (env, mTLS, its unit, ufw for its port),
# its cores added later from the node page. The older spellings still work: --protocol <p> adds
# the core <p> runs on (shadowsocks runs on xray; tuic, anytls and shadowtls on
# singbox), so a command an older panel printed installs what it always did;
# --with-singbox adds singbox. Install flags follow the core they belong to:
# --hysteria-* act when hysteria is in the set, --xray-reality-* when xray is.
#
# Usage (as root). Recommended: bootstrap-token flow (single command, no
# manual file transfer needed):
#
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_AbC123dEf456 \
#     --engines xray
#
# Get the bootstrap token + ready-made command by clicking "Create node"
# in the panel UI: the modal shows a copy-pastable single-liner. Token is
# valid 15 min, single-use; if it expires, click "Refresh bootstrap" in
# the panel UI to mint a new one.
#
# Security note: `--bootstrap <tok>` exposes the token in /proc/<pid>/cmdline
# for the lifetime of the install (any local unprivileged process can read
# it). For shared VPS or audit-logged hosts, write the token to a 0600 file
# and pass `--bootstrap-file /path/to/token` instead, so the token never
# enters argv. Convention matches --payload-file.
#
# === ONE-COMMAND PROTOCOL SETUP ===
#
# For a fully-configured node (node-agent + protocol server + systemd unit
# + ACME cert) pass per-protocol flags. Otherwise install-iceslab-node.sh installs
# the binaries and you have to drop config files manually.
#
# Hysteria 2: the agent writes its config and gets its certificate on the
# panel's first push (ACME for the domain below; a node on an IP gets the
# panel's self-signed one). Nothing is started here (E34):
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --engines hysteria \
#     --hysteria-domain hy2-01.example.com \
#     --hysteria-email admin@example.com
#   # Optional: --hysteria-port-range 20000-50000   (port-hopping;
#   #             defeats RU TSPU UDP/443 throttle. Pass "" to disable.)
#   # --hysteria-masquerade-url / --hysteria-obfs-password are still accepted
#   # and do nothing: masquerade and obfuscation come from the panel's profile.
#
# Xray, pre-fill REALITY env so adapter starts immediately. Get keypair
# from the inbound creation form (panel UI: Inbounds > Create > Generate):
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --engines xray \
#     --xray-reality-private-key sI_p9bg-7cy... \
#     --xray-reality-short-ids abc123 \
#     --xray-reality-server-names www.cloudflare.com \
#     --xray-reality-dest www.cloudflare.com:443
#   # Optional: --xray-port 443
#
# AmneziaWG / NaiveProxy / Shadowsocks / MTProto / Mieru: these protocols
# take no install-time flags; they start idle and wait for the panel to push
# inbound config via applyInbounds. Set protocol-specific fields (domain,
# email, masquerade, etc.) on the panel-side Profile via the admin UI.
#
# === ZASHCHITA (hardening, probe-resistance) ===
#
# Optional, protocol-independent. Emitted by the panel's node "Zashchita"
# wizard; all default off (a node without them installs identically):
#   --harden-ufw            rate-limit SSH (ufw limit) + tighten the firewall
#   --fail2ban              install + enable fail2ban with an sshd jail
#   --ssh-allowlist <csv>   lock 22/tcp to these IP/CIDRs only (comma-list)
#   --realistic-fallback    record REALISTIC_FALLBACK=1 in the node env so the
#                           agent serves a real-looking fallback on probe
# Example:
#   bash <(curl -fsSL .../install-iceslab-node.sh) \
#     --panel-url https://panel.example.com --bootstrap bs_xxx --protocol xray \
#     --harden-ufw --fail2ban --ssh-allowlist 203.0.113.4,10.0.0.0/8
#
# Alternative flows (file-based, for air-gapped or self-hosted gist setups):
#   bash <(curl -fsSL .../install-iceslab-node.sh) --protocol xray --payload-file /tmp/payload.b64
#   bash <(curl -fsSL .../install-iceslab-node.sh) --protocol xray --payload "@/tmp/payload.b64"
#
# No core named at all: the agent alone, the cores added later from the node
# page. Without --payload/--bootstrap it asks for the payload (accepts
# `@/path/to/file` syntax):
#   bash <(curl -fsSL .../install-iceslab-node.sh)
#
# Don't paste the raw payload string into the terminal directly. Linux
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
#     # a clean machine: stops the agent and every core, takes each core off
#     # with its bootstrap's --remove, then removes the unit, binary,
#     # /etc/iceslab-node, /opt/iceslab-node and the UFW allow-rule for
#     # $NODE_PORT/tcp. Ends with "Removed: agent, ...; kept: ...".
#     # Add --keep-cores to leave the cores on the machine (the old behaviour).
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
  printf '  Re-run with the same flags; install is idempotent.\n' >&2
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
  printf '  v0.2.0  ·  github.com/icecompany-tech/iceslab\n'
  printf '\n'
}

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash $0)"

banner

# ───── Concurrency + apt lock hygiene ─────
# flock against concurrent runs, apt's own wait (DPkg::Lock::Timeout) on every
# apt call, and a wait for a running apt before the first one (wait_for_apt).
exec 9>/var/run/iceslab-node-install.lock || fail "cannot open install lockfile"
if ! flock -n 9; then
  fail "another install-iceslab-node.sh is already running. Wait, or remove /var/run/iceslab-node-install.lock if you're sure it crashed."
fi

APT_OPTS=(-o "DPkg::Lock::Timeout=300" -o "Dpkg::Options::=--force-confold" -o "Dpkg::Options::=--force-confdef")
APT_ENV=(env DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none)

# apt's locks, and why this installer never deletes one.
#
# 26.09 on ru-01: every --uninstall printed four
# "stale apt lock ... removing" lines on a machine where apt never ran. These
# four files exist on every Debian/Ubuntu for good; apt and dpkg lock them with
# fcntl (F_SETLK) on an open descriptor, not by creating them. The old check
# called a file "stale" when `fuser` named no holder, and on a machine without
# psmisc `fuser` does not exist, so every file read as unheld and was deleted,
# a running unattended-upgrades' included: a second apt then takes a fresh
# file, and two package managers write /var/lib/dpkg at once.
#
# A lock file nobody holds needs no removing: an fcntl lock dies with its
# process, a crashed apt leaves nothing locked. So the files are never touched.
# What is done instead: wait while apt or dpkg runs (APT_WAIT_SECONDS, default
# 300), fail in words if it outlasts that, and only on a quiet machine finish
# what a crashed dpkg left half-configured.
APT_LOCKS="/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock"
APT_WAIT_SECONDS="${APT_WAIT_SECONDS:-300}"

# apt_busy: why apt is busy, or nothing when it is not. Any one of three is
# enough: a package-manager process, a lock `lslocks` lists (util-linux, on
# every such system; it sees fcntl locks, which `flock -n` does not), a holder
# `fuser` names where psmisc is installed.
apt_busy() {
  local p locks f holders
  for p in apt apt-get aptitude dpkg unattended-upgr; do
    if pgrep -x "$p" >/dev/null 2>&1; then
      printf '%s is running' "$p"
      return 0
    fi
  done
  locks="$(lslocks -n -o PATH 2>/dev/null || true)"
  for f in $APT_LOCKS; do
    if grep -qxF "$f" <<<"$locks"; then
      printf '%s is locked' "$f"
      return 0
    fi
    if command -v fuser >/dev/null 2>&1 && [[ -e "$f" ]]; then
      holders="$(fuser "$f" 2>/dev/null || true)"
      if [[ -n "${holders// /}" ]]; then
        printf '%s is held by pid%s' "$f" "$holders"
        return 0
      fi
    fi
  done
  return 0
}

wait_for_apt() {
  local why waited=0
  why="$(apt_busy)"
  [[ -z "$why" ]] && { dpkg --configure -a >/dev/null 2>&1 || true; return 0; }
  log "apt is busy ($why), waiting up to ${APT_WAIT_SECONDS}s"
  while [[ -n "$why" ]]; do
    if (( waited >= APT_WAIT_SECONDS )); then
      fail "apt busy ($why) for ${APT_WAIT_SECONDS}s; retry later, once it has finished (the lock files are left alone on purpose)"
    fi
    sleep 5
    waited=$((waited + 5))
    why="$(apt_busy)"
  done
  dpkg --configure -a >/dev/null 2>&1 || true
}
wait_for_apt

ICESLAB_NODE_DIR=${ICESLAB_NODE_DIR:-/opt/iceslab-node}
ICESLAB_NODE_REPO=${ICESLAB_NODE_REPO:-https://github.com/icecompany-tech/iceslab.git}
ICESLAB_NODE_REF=${ICESLAB_NODE_REF:-v0.2.0}

# ───── Cores ─────
#
# Every core, its pin, its checksum and its download live in its bootstrap
# (apps/node/scripts/bootstrap-<core>.sh), generated from the version manifest
# (packages/shared/src/core-versions.ts). This installer carries no pin block
# and downloads no core itself: the hysteria copy it kept here (upstream's
# install_server.sh plus its own pin) went with --engines, and hysteria now goes
# on through bootstrap-hysteria.sh like every other core.

# apply_core_versions_from_payload <agent binary>
# The panel resolves the node's intent (Node.coreVersions) into the payload's
# coreVersions block: the release of every core, with its files and sha256s.
# The freshly built agent turns that into env pairs for THIS machine's arch
# (`iceslab-node core-env`), and each pair becomes the default for the
# bootstrap script that reads it. Three sources, in order of strength:
#   an explicit pair in the operator's env    wins, left exactly as it is;
#   the payload's pair                        otherwise;
#   the script's own generated pin block      when neither says anything.
# A pair is taken whole or not at all, because a script takes no version
# without its checksum.
#
# Nothing here fails the install. A checkout older than the panel may build an
# agent that knows no `core-env`, or not the component the panel sent: that is
# a warning, and the script installs its own pin.
apply_core_versions_from_payload() {
  local bin="$1" out key value prefix a b
  [[ -n "${PAYLOAD:-}" ]] || return 0
  if ! out=$(printf '%s' "$PAYLOAD" | env -u NODE_PAYLOAD "$bin" core-env); then
    warn "this agent cannot read the panel's core versions (checkout older than the panel?); every core gets its script's own pin"
    return 0
  fi
  declare -A from_payload=()
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    case "$key" in
      XRAY_VERSION|XRAY_SHA256|SINGBOX_VERSION|SINGBOX_SHA256|HYSTERIA_VERSION|HYSTERIA_SHA256|\
      MTG_VERSION|MTG_SHA256|MIERU_VERSION|MIERU_SHA256|\
      AWG_MODULE_TAG|AWG_MODULE_SHA|AWG_TOOLS_TAG|AWG_TOOLS_SHA)
        from_payload[$key]="$value" ;;
      *) warn "the panel names $key, which this installer does not know; that core keeps its script's own pin" ;;
    esac
  done <<<"$out"

  for prefix in XRAY SINGBOX HYSTERIA MTG MIERU AWG_MODULE AWG_TOOLS; do
    case "$prefix" in
      AWG_*) a="${prefix}_TAG"; b="${prefix}_SHA" ;;
      *)     a="${prefix}_VERSION"; b="${prefix}_SHA256" ;;
    esac
    [[ -n "${from_payload[$a]:-}" && -n "${from_payload[$b]:-}" ]] || continue
    if [[ -n "${!a:-}" || -n "${!b:-}" ]]; then
      log "core versions: $a/$b set in the environment, the panel's choice is not used"
      continue
    fi
    export "$a=${from_payload[$a]}" "$b=${from_payload[$b]}"
    log "core versions: ${a}=${from_payload[$a]} from the panel"
  done
}

NODE_HOST=${NODE_HOST:-0.0.0.0}
# Default moved to 1337 (2026-05-21). The old 8443 is the canonical
# HTTPS-alt port and the first thing every bot probes after 443. 1337
# stays out of standard scanner profiles and frees 8443 for actual
# user-protocol bindings (xray-on-8443 is a common Cloudflare-friendly
# fallback). Old installs are not migrated automatically: their
# node.address in DB is still :8443 and the systemd unit is still :8443.
# Operators on existing nodes can leave as-is or re-bootstrap with
# `--reset --port 1337` to align with the new default.
NODE_PORT=${NODE_PORT:-1337}

PROTOCOL=""
ENGINES_ARG=""
ENGINES_GIVEN=0   # --engines was passed at all, even as ''
WITH_SINGBOX=0
PAYLOAD=""
PANEL_URL=""
BOOTSTRAP_TOKEN=""
RESET=0
UNINSTALL=0
KEEP_CORES=0
# UFW lock-down. When set, only this IP/CIDR (or comma-list) is allowed to
# reach :NODE_PORT. Without it the mTLS port is open to the whole internet:
# mTLS rejects everyone, but bots still spend our CPU on TLS handshakes and
# the agent leaks "I'm Iceslab" via the cert SAN.
PANEL_IP=""

# Zashchita (hardening): probe-resistance toggles pushed from the panel's
# node "Zashchita" wizard. Each maps 1:1 to a key in nodes.hardening (jsonb).
# All default off so a node without hardening installs byte-identically.
#   --harden-ufw         : rate-limit SSH (`ufw limit`), tighten the firewall
#                          beyond the default per-protocol allows.
#   --fail2ban           : install + enable fail2ban with an sshd jail (bans
#                          IPs that brute-force SSH; raises probe/scan cost).
#   --ssh-allowlist <csv>: comma-list of IP/CIDR; locks 22/tcp to these only
#                          instead of world-open. Mirrors the --panel-ip loop.
#   --realistic-fallback : record REALISTIC_FALLBACK=1 into the node env so the
#                          agent serves a real-looking fallback site on probe
#                          instead of a bare reset (active-probe resistance).
HARDEN_UFW=0
FAIL2BAN=0
REALISTIC_FALLBACK=0
SSH_ALLOWLIST=""   # comma-list of IP/CIDR; empty = keep world-open 22/tcp

# Hysteria 2 (only used when hysteria is a core): the domain and e-mail its
# ACME certificate is asked for, written to the agent's env (core_flags_env);
# the agent renders the config on the panel's first push (E34). The masquerade
# and obfs flags are accepted for old commands and unused: the profile says.
HY_DOMAIN=""
HY_EMAIL=""
HY_MASQUERADE_URL=""
HY_OBFS_PASSWORD=""
# Port-hopping. iptables NAT-REDIRECT for a UDP port range so clients can
# rotate destination ports per connection (mport=START-END in the URI).
# Defeats RU TSPU / IR / CN fixed-port UDP/443 throttle. The default range
# is wide enough to give clients room without colliding with common service
# ports. Admin can narrow or widen via flag. The range here must be a
# superset of any per-profile range emitted in the panel, otherwise the
# hysteria. Set up by bootstrap-hysteria.sh, which reads it as
# HYSTERIA_PORT_RANGE.
HY_PORT_RANGE="20000-50000"

# Xray REALITY inbound params (only used when xray is a core). When the
# required ones are passed, they're written into /etc/iceslab-node/env so
# the node-agent's xray adapter spawns a REALITY listener at startup.
# Without these flags the Xray adapter stays disabled until the admin edits
# the env file manually (panel will auto-push these later).
XR_PRIVATE_KEY=""
XR_PUBLIC_KEY=""
XR_SHORT_IDS=""
XR_SERVER_NAMES="www.cloudflare.com"
XR_DEST="www.cloudflare.com:443"
XR_PORT="443"

# Resolve a payload value: if it starts with "@", treat the rest as a path
# and read the file content. Otherwise return as-is. Mirrors curl's `-d @file`
# convention. Matters for long payloads: Linux TTY canonical-mode buffer
# truncates pastes at 4096 bytes, so anything pasted directly into the
# terminal (or via `--payload "..."` with the user shell-pasting into the
# command line) gets cut. File-backed payload sidesteps the TTY entirely.
# Wipe everything install-iceslab-node.sh creates: systemd unit, binary, source
# checkout, env dir, UFW allow-rule for the mTLS port, and the per-protocol
# config the script generates (hysteria/xray service config).
# The core binaries are not this function's: --uninstall takes them off first
# (uninstall_all below, E41), and --reset and --keep-cores leave them, so only
# the config files tied to the panel's domain/email/keys are wiped here.
# Idempotent, safe on a half-installed VPS.
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

  # Port-hopping cleanup. Stopping the systemd unit fires its ExecStop=
  # which calls `iceslab-hyhop down` to remove the iptables rule. After
  # that we can remove the script + unit.
  systemctl stop iceslab-hyhop 2>/dev/null || true
  systemctl disable iceslab-hyhop 2>/dev/null || true
  rm -f /etc/systemd/system/iceslab-hyhop.service
  rm -f /usr/local/bin/iceslab-hyhop
  systemctl daemon-reload || true

  log "Removing binary"
  rm -f /usr/local/bin/iceslab-node

  log "Removing env directory (/etc/iceslab-node)"
  rm -rf /etc/iceslab-node

  # fail2ban: remove only our jail/filter (leave the fail2ban package
  # installed, it may protect other services). jail.local is the legacy
  # path written by older versions of this script.
  rm -f /etc/fail2ban/jail.d/iceslab.local \
        /etc/fail2ban/filter.d/iceslab-hysteria.conf \
        /etc/fail2ban/jail.local
  systemctl reload fail2ban 2>/dev/null || true

  log "Removing source checkout ($ICESLAB_NODE_DIR)"
  rm -rf "$ICESLAB_NODE_DIR"

  if command -v ufw >/dev/null && ufw status | grep -q "${NODE_PORT}/tcp"; then
    log "Removing UFW allow rule for ${NODE_PORT}/tcp"
    ufw --force delete allow "${NODE_PORT}/tcp" >/dev/null || true
  fi
}

# ───── --uninstall: the cores too ─────
#
# E41, 25.09 on ru-01: --uninstall stopped at the agent (do_uninstall above
# keeps upstream binaries by design). xray, sing-box, hysteria and the AWG
# module stayed on the machine, the next install without --engines found them,
# the node came up "without cores" while everything stood there, and a host
# bound to it by the fact. To an operator --uninstall means a clean machine.
#
# So --uninstall is now, in this order:
#   1. stop the agent, so nothing starts a core again;
#   2. stop every core our bootstraps put on a machine (stop_cores);
#   3. run each bootstrap-*.sh --remove from the checkout while it is still
#      there (remove_cores); a --remove refuses a running core, hence 2 first;
#   4. do_uninstall, which removes the checkout last.
# --keep-cores keeps the old behaviour (1 and 4 only), for an operator who
# keeps the cores themselves.

# The processes of the cores our bootstraps install, by name.
CORE_PROCESSES="xray sing-box hysteria mtg caddy-naive mita"

# stop_cores: every core down, whoever started it: the agent (its children),
# systemd (units of older installs, mita, awg-quick@), or by hand.
stop_cores() {
  local u i p left
  for u in hysteria hysteria-server mita xray caddy-naive mtg iceslab-hyhop; do
    systemctl stop "$u" >/dev/null 2>&1 || true
  done
  for u in $(systemctl list-units --plain --no-legend 'xray@*' 'awg-quick@*' 2>/dev/null | awk '{print $1}' || true); do
    systemctl stop "$u" >/dev/null 2>&1 || true
  done
  # Every AmneziaWG interface, the users' and a cascade leg's alike.
  for i in $(ip -o link show type amneziawg 2>/dev/null | awk -F': ' '{print $2}' || true); do
    i="${i%%@*}"
    awg-quick down "$i" >/dev/null 2>&1 || ip link del "$i" >/dev/null 2>&1 || true
  done
  for p in $CORE_PROCESSES; do
    pkill -TERM -x "$p" >/dev/null 2>&1 || true
  done
  for _ in 1 2 3 4 5; do
    left=""
    for p in $CORE_PROCESSES; do
      if pgrep -x "$p" >/dev/null 2>&1; then left+="$p "; fi
    done
    [[ -z "$left" ]] && return 0
    sleep 1
  done
  for p in $left; do
    pkill -KILL -x "$p" >/dev/null 2>&1 || true
  done
}

# core_present <engine>: something of this core is on the machine, the fact
# the summary is written from.
core_present() {
  case "$1" in
    xray)      [[ -e /usr/local/bin/xray ]] ;;
    singbox)   [[ -e /usr/local/bin/sing-box ]] ;;
    hysteria)  [[ -e /usr/local/bin/hysteria ]] ;;
    mtproto)   [[ -e /usr/local/bin/mtg ]] ;;
    naive)     [[ -e /usr/local/bin/caddy-naive ]] ;;
    mieru)     [[ -e /usr/local/bin/mita ]] || dpkg -s mita >/dev/null 2>&1 ;;
    amneziawg) command -v awg >/dev/null 2>&1 || [[ -n "$(dkms status amneziawg 2>/dev/null || true)" ]] ;;
    *) return 1 ;;
  esac
}

# remove_cores <scripts dir>: each bootstrap's --remove, the present cores and
# the absent ones alike (a --remove of nothing is quiet, and it sweeps what an
# older install left). Sets REMOVED_CORES and KEPT_CORES for the summary, from
# what was present before.
remove_cores() {
  local dir="$1" e script present
  REMOVED_CORES=()
  KEPT_CORES=()
  for e in $KNOWN_ENGINES; do
    present=0
    core_present "$e" && present=1
    script="$dir/$(bootstrap_of "$e")"
    if [[ ! -f "$script" ]]; then
      [[ $present -eq 1 ]] && KEPT_CORES+=("$e (no $script)")
      continue
    fi
    # A bootstrap from before --remove takes the flag for an install: it would
    # put the core BACK on the machine. Asked of the file, not a pipe.
    if ! grep -q 'NODE_ENV_REMOVE' "$script"; then
      [[ $present -eq 1 ]] && KEPT_CORES+=("$e (the checkout predates --remove)")
      continue
    fi
    # ICESLAB_UNINSTALL: every core goes, so a bootstrap's warning about what
    # its removal leaves another core without is noise here.
    if ICESLAB_UNINSTALL=1 bash "$script" --remove; then
      [[ $present -eq 1 ]] && REMOVED_CORES+=("$e")
    elif [[ $present -eq 1 ]]; then
      KEPT_CORES+=("$e (its --remove refused, see above)")
    fi
  done
  # Not the status of the last `[[ present ]] &&` above: under set -e a core
  # that was simply absent would end the uninstall here.
  return 0
}

# uninstall_all: --uninstall, in the order the block above explains.
uninstall_all() {
  local removed kept
  log "Stopping iceslab-node service (if running)"
  systemctl stop iceslab-node 2>/dev/null || true
  REMOVED_CORES=()
  KEPT_CORES=()
  if [[ $KEEP_CORES -eq 1 ]]; then
    log "--keep-cores: the cores stay on this machine"
  else
    log "Stopping every core"
    stop_cores
    log "Removing the cores (bootstrap-*.sh --remove)"
    remove_cores "$ICESLAB_NODE_DIR/apps/node/scripts"
  fi
  do_uninstall
  local e
  removed="agent"
  for e in "${REMOVED_CORES[@]}"; do removed+=", $e"; done
  kept=""
  for e in "${KEPT_CORES[@]}"; do kept+="${kept:+, }$e"; done
  [[ $KEEP_CORES -eq 1 ]] && kept="every core (--keep-cores)"
  log "Removed: ${removed}; kept: ${kept:-none}"
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

# A bootstrap token passed as `--bootstrap <tok>` ends up in
# /proc/<pid>/cmdline for the lifetime of the install: any unprivileged
# local process can grab it and (within the 15-min TTL) issue a full mTLS
# keypair against the panel for this node. Reading from a file avoids the
# argv exposure; same shape as resolve_payload's @file convention.
resolve_bootstrap() {
  local value="$1"
  [[ -r "$value" ]] || fail "Cannot read bootstrap-file: $value"
  tr -d '\n\r \t' < "$value"
}

# ───── Cores: which, and how each goes on ─────

KNOWN_ENGINES="xray singbox hysteria amneziawg mtproto mieru naive"

# native_engine_of <protocol>: the core a --protocol runs on. The protocol is
# a label of the install, not a core: shadowsocks runs inside xray, and tuic,
# anytls and shadowtls run on sing-box.
native_engine_of() {
  case "$1" in
    xray|shadowsocks)                       echo xray ;;
    tuic|anytls|shadowtls)                  echo singbox ;;
    hysteria|amneziawg|naive|mtproto|mieru) echo "$1" ;;
    *) return 1 ;;
  esac
}

# bootstrap_of <engine>: its script under apps/node/scripts. The same table as
# ENGINE_BOOTSTRAP in packages/shared/src/core-versions.ts, which the panel's
# "how to install" reads; bootstrap_env_test.go holds the two together.
bootstrap_of() {
  case "$1" in
    xray)      echo bootstrap-xray.sh ;;
    singbox)   echo bootstrap-singbox.sh ;;
    hysteria)  echo bootstrap-hysteria.sh ;;
    amneziawg) echo bootstrap-amneziawg.sh ;;
    mtproto)   echo bootstrap-mtg.sh ;;
    mieru)     echo bootstrap-mieru.sh ;;
    naive)     echo bootstrap-naive.sh ;;
    *) return 1 ;;
  esac
}

# resolve_engines: ENGINES, the set of cores this node gets; none of them is
# the main one. --engines names them; --protocol, the older spelling, adds the
# core it runs on; --with-singbox adds singbox. The set may be empty: nothing
# named installs the agent alone, and the cores come later from the node page.
# `--engines ''` is refused all the same: it names a list and puts nothing in.
#
# The order means nothing to the node. It matters only to an old checkout,
# which installs the first core alone (install_engines), so the core of
# --protocol goes first: that is the one such a command always installed.
resolve_engines() {
  local native e seen=" " listed=" "
  ENGINES=()
  if [[ -n "$PROTOCOL" ]]; then
    native="$(native_engine_of "$PROTOCOL")" || fail "Unknown protocol: $PROTOCOL"
    ENGINES=("$native")
    seen+="$native "
  fi
  if [[ "$ENGINES_GIVEN" == 1 || -n "$ENGINES_ARG" ]]; then
    local -a named=()
    IFS=',' read -ra named <<<"${ENGINES_ARG// /}"
    for e in "${named[@]}"; do
      [[ -n "$e" ]] || continue
      [[ " $KNOWN_ENGINES " == *" $e "* ]] || fail "--engines: unknown core '$e' (known: ${KNOWN_ENGINES// /, })"
      [[ "$listed" != *" $e "* ]] || fail "--engines: '$e' is named twice"
      listed+="$e "
      if [[ "$seen" != *" $e "* ]]; then
        ENGINES+=("$e")
        seen+="$e "
      fi
    done
    [[ "$listed" != " " ]] || fail "--engines names no core"
  fi
  if [[ "$WITH_SINGBOX" == 1 && "$seen" != *" singbox "* ]]; then
    ENGINES+=(singbox)
  fi
}

has_engine() { [[ " ${ENGINES[*]} " == *" $1 "* ]]; }

# core_flags_env: the install flags of each core in the set, into the env. By
# the core, not by --protocol: --hysteria-domain acts on any node with
# hysteria, a REALITY key on any node with xray.
core_flags_env() {
  # Hysteria's identity from --hysteria-domain / --hysteria-email, so the
  # agent's rewrites of the hysteria config keep it (without these it fell back
  # to "your.domain.net" on the next write; caught live on the first install).
  if has_engine hysteria; then
    if [[ -n "$HY_DOMAIN" ]]; then echo "HYSTERIA_HOSTNAME=${HY_DOMAIN}" >> "$ENV_FILE"; fi
    if [[ -n "$HY_EMAIL" ]]; then echo "HYSTERIA_ACME_EMAIL=${HY_EMAIL}" >> "$ENV_FILE"; fi
  fi
  # Xray REALITY pre-filled from --xray-reality-*, so the adapter starts at once.
  if has_engine xray && [[ -n "$XR_PRIVATE_KEY" && -n "$XR_SHORT_IDS" ]]; then
    cat >> "$ENV_FILE" <<EOF
XRAY_REALITY_PRIVATE_KEY=${XR_PRIVATE_KEY}
XRAY_REALITY_SHORT_IDS=${XR_SHORT_IDS}
XRAY_REALITY_SERVER_NAMES=${XR_SERVER_NAMES}
XRAY_REALITY_DEST=${XR_DEST}
XRAY_PORT=${XR_PORT}
EOF
    log "Xray REALITY env populated (port=${XR_PORT}, sni=${XR_SERVER_NAMES})"
  fi
}

# run_bootstrap <engine> <scripts dir>: one core's bootstrap, in a process of
# its own, its output shown as it runs and kept. Returns the bootstrap's exit
# code; its last line (colours stripped) is left in BOOTSTRAP_LAST, which for a
# refusal is the `[fail]` line that says why.
#
# Called only as a condition (`if run_bootstrap ...`), so neither `set -e` nor
# the ERR trap ends the install on a core that failed: E32, 25.09, mieru failed
# on nl-01 and set -e took the agent's unit, ufw, fail2ban and the four other
# cores down with it, after the one-shot bootstrap token was already spent.
run_bootstrap() {
  local e="$1" dir="$2" out rc
  out=$(mktemp)
  bash "$dir/$(bootstrap_of "$e")" 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}
  BOOTSTRAP_LAST=$(sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -v '^[[:space:]]*$' | tail -n 1)
  rm -f "$out"
  return "$rc"
}

# The cores that went on, and the ones that did not with the reason, filled by
# install_engines. core_ok <engine>: it is in the first list.
core_ok() { [[ " ${INSTALLED_ENGINES[*]} " == *" $1 "* ]]; }

# cores_summary: the lines the end of the install prints about the cores, one
# per failed core with the command that puts it on later.
cores_summary() {
  local i
  printf '  Cores        %s\n' "${INSTALLED_ENGINES[*]:-no cores installed, add them from the node page}"
  for i in "${!FAILED_ENGINES[@]}"; do
    printf '  FAILED       %s: %s\n' "${FAILED_ENGINES[$i]}" "${FAILED_REASONS[$i]}"
    printf '               install later: sudo bash %s/apps/node/scripts/%s --restart-agent\n' \
      "$ICESLAB_NODE_DIR" "$(bootstrap_of "${FAILED_ENGINES[$i]}")"
  done
}

# install_engines <scripts dir>: the bootstrap of every core in ENGINES, in
# order. Each installs its core and writes its own block of the env (see
# lib/node-env.sh there), so nothing about a core is repeated in this file.
#
# A core that fails does not stop the install: the others, the agent and its
# unit still go on, the node reports what it runs, and the end of the install
# names the failed core, why, and how to add it later (E32). Its exit code is
# the install's, non-zero, but the node is up.
#
# A checkout from before that (no lib/node-env.sh) has bootstraps that only
# install: it gets the first core alone, wired by legacy_primary_env below, and
# a warning that says what fixes it.
install_engines() {
  local dir="$1" e
  INSTALLED_ENGINES=()
  FAILED_ENGINES=()
  FAILED_REASONS=()
  BOOTSTRAP_LAST=""
  if [[ ${#ENGINES[@]} -eq 0 ]]; then
    log "No core named: the agent alone, its cores come from the node page"
    return 0
  fi
  if [[ ! -f "$dir/lib/node-env.sh" ]]; then
    warn "the checkout at $ICESLAB_NODE_DIR ($ICESLAB_NODE_REF) predates --engines: its bootstraps do not wire their core into the agent"
    warn "installing only one core, ${ENGINES[0]}, wired by this installer"
    if [[ ${#ENGINES[@]} -gt 1 ]]; then
      warn "NOT installed: ${ENGINES[*]:1}"
    fi
    warn "to fix: rerun this installer with ICESLAB_NODE_REF=main, or on this node"
    warn "  git -C $ICESLAB_NODE_DIR fetch --depth 1 origin main && git -C $ICESLAB_NODE_DIR reset --hard FETCH_HEAD"
    warn "  and then for each missing core: sudo bash $dir/bootstrap-<core>.sh --restart-agent"
    warn "  (rebuilding the agent from that checkout by hand needs Go: this installer put it in /usr/local/go;"
    warn "  a node where 'go' is missing gets it back by rerunning this installer,"
    warn "  or by unpacking go${GO_VERSION:-1.23.4} there and linking /usr/local/go/bin/go into /usr/local/bin)"
    LEGACY_CHECKOUT=1
    if run_bootstrap "${ENGINES[0]}" "$dir"; then
      legacy_primary_env
      INSTALLED_ENGINES+=("${ENGINES[0]}")
    else
      warn "core ${ENGINES[0]} failed: ${BOOTSTRAP_LAST:-no output}"
      FAILED_ENGINES+=("${ENGINES[0]}")
      FAILED_REASONS+=("${BOOTSTRAP_LAST:-no output}")
    fi
    return 0
  fi
  for e in "${ENGINES[@]}"; do
    log "Core $e: $(bootstrap_of "$e")"
    if run_bootstrap "$e" "$dir"; then
      INSTALLED_ENGINES+=("$e")
    else
      warn "core $e failed: ${BOOTSTRAP_LAST:-no output}; the install goes on without it"
      FAILED_ENGINES+=("$e")
      FAILED_REASONS+=("${BOOTSTRAP_LAST:-no output}")
    fi
  done
}

# legacy_primary_env: what this installer wrote for the one core an old
# checkout installs, before the bootstraps wrote it themselves. For an old
# checkout ONLY (install_engines); delete once no supported release lacks
# lib/node-env.sh. Keyed by --protocol when given (shadowsocks has its own
# config), else by that core.
legacy_primary_env() {
  case "${PROTOCOL:-${ENGINES[0]}}" in
    hysteria)
      {
        echo "HYSTERIA_BINARY=/usr/local/bin/hysteria"
        echo "HYSTERIA_CONFIG=/etc/hysteria/config.yaml"
        echo "HYSTERIA_AUTH_PORT=9000"
        echo "HYSTERIA_STATS_LISTEN=127.0.0.1:9999"
        echo "HYSTERIA_STATS_SECRET=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        # The unit exists only where the ACME branch below writes it.
        if [[ -n "$HY_DOMAIN" && -n "$HY_EMAIL" ]]; then echo "HYSTERIA_SERVICE_UNIT=hysteria"; fi
      } >>"$ENV_FILE" ;;
    xray)
      printf 'XRAY_BINARY=/usr/local/bin/xray\nXRAY_CONFIG=/usr/local/etc/xray/config.json\n' >>"$ENV_FILE" ;;
    shadowsocks)
      printf 'XRAY_BINARY=/usr/local/bin/xray\nSHADOWSOCKS_CONFIG=/etc/xray/shadowsocks.json\n' >>"$ENV_FILE" ;;
    naive)
      printf 'CADDY_NAIVE_BIN=/usr/local/bin/caddy-naive\nNAIVE_CONFIG=/etc/caddy/Caddyfile\n' >>"$ENV_FILE" ;;
    mtproto)
      printf 'MTG_BINARY=/usr/local/bin/mtg\nMTG_CONFIG=/etc/mtg/config.toml\n' >>"$ENV_FILE" ;;
    mieru)
      printf 'MITA_BINARY=/usr/local/bin/mita\nMITA_CONFIG=/etc/mita/server.json\n' >>"$ENV_FILE" ;;
    singbox|tuic|anytls|shadowtls)
      printf 'SINGBOX_BINARY=/usr/local/bin/sing-box\nSINGBOX_CERT=/etc/sing-box/cert.pem\nSINGBOX_KEY=/etc/sing-box/key.pem\n' >>"$ENV_FILE" ;;
    amneziawg) ;; # the agent finds awg on its own
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    # The older spelling of a core: adds the one this protocol runs on.
    --protocol)      PROTOCOL="$2"; shift 2 ;;
    --payload)     PAYLOAD=$(resolve_payload "$2"); shift 2 ;;
    --payload-file)  PAYLOAD=$(resolve_payload "@$2"); shift 2 ;;
    --panel-url)     PANEL_URL="${2%/}"; shift 2 ;;
    # --bootstrap exposes the token in /proc/cmdline; prefer --bootstrap-file
    # in non-trusted environments (shared VPS, audit-logged hosts).
    --bootstrap)         BOOTSTRAP_TOKEN="$2"; shift 2 ;;
    --bootstrap-file)    BOOTSTRAP_TOKEN=$(resolve_bootstrap "$2"); shift 2 ;;
    --port)          NODE_PORT="$2"; shift 2 ;;
    # Hysteria 2: the ACME name and e-mail for the agent's env (E34: nothing
    # is configured or started here any more).
    --hysteria-domain)         HY_DOMAIN="$2"; shift 2 ;;
    --hysteria-email)          HY_EMAIL="$2"; shift 2 ;;
    --hysteria-masquerade-url) HY_MASQUERADE_URL="$2"; shift 2 ;;
    --hysteria-obfs-password)  HY_OBFS_PASSWORD="$2"; shift 2 ;;
    # Port-hopping iptables redirect range. Accepts `START-END` (hyphen).
    # Pass empty string to disable port-hopping on this node (then iptables
    # stays untouched).
    --hysteria-port-range)     HY_PORT_RANGE="$2"; shift 2 ;;
    # Xray REALITY: pre-fill env so the adapter starts immediately
    --xray-reality-private-key)  XR_PRIVATE_KEY="$2"; shift 2 ;;
    --xray-reality-public-key)   XR_PUBLIC_KEY="$2"; shift 2 ;;
    --xray-reality-short-ids)    XR_SHORT_IDS="$2"; shift 2 ;;
    --xray-reality-server-names) XR_SERVER_NAMES="$2"; shift 2 ;;
    --xray-reality-dest)         XR_DEST="$2"; shift 2 ;;
    --xray-port)                 XR_PORT="$2"; shift 2 ;;
    # Re-installation flow on a VPS that already hosts a previous agent:
    #   --reset      : wipe prior state silently before installing
    #   --uninstall  : wipe prior state and exit (no install)
    # Without either flag, a detected prior install triggers an interactive
    # "overwrite? [y/N]" prompt; non-interactive runs (no tty) abort.
    --reset)         RESET=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    # With --uninstall: leave the cores on the machine (the behaviour before
    # E41), for an operator who keeps them themselves.
    --keep-cores)    KEEP_CORES=1; shift ;;
    --panel-ip)      PANEL_IP="$2"; shift 2 ;;
    # Zashchita (hardening): see the HARDEN_UFW/FAIL2BAN block above.
    --harden-ufw)         HARDEN_UFW=1; shift ;;
    --fail2ban)           FAIL2BAN=1; shift ;;
    --realistic-fallback) REALISTIC_FALLBACK=1; shift ;;
    --ssh-allowlist)      SSH_ALLOWLIST="$2"; shift 2 ;;
    # The cores this node gets, comma-separated, in any order:
    # xray,singbox,hysteria,amneziawg,mtproto,mieru,naive. See resolve_engines.
    --engines)            ENGINES_ARG="$2"; ENGINES_GIVEN=1; shift 2 ;;
    # The old spelling of adding singbox, still accepted.
    --with-singbox)       WITH_SINGBOX=1; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

# ───── -1. Uninstall fast-path ─────
# Run BEFORE bootstrap-token redemption, otherwise `--uninstall` would
# pointlessly consume a one-shot bootstrap token.
if [[ $UNINSTALL -eq 1 ]]; then
  # Not gated on the agent any more: a machine an older --uninstall left with
  # its cores has no agent and still is not clean (E41).
  log "Uninstalling iceslab-node"
  uninstall_all
  ok "Uninstall complete. Rerun install-iceslab-node.sh to set up a fresh agent."
  exit 0
fi

# If both --panel-url and --bootstrap given, redeem the bootstrap token to
# fetch the full payload from panel over HTTP. This is the recommended flow:
# it sidesteps the 4 KB TTY paste limit because the long payload travels
# over a plain HTTP body, not through the user's shell.
if [[ -n "$BOOTSTRAP_TOKEN" && -n "$PANEL_URL" ]]; then
  log "Redeeming bootstrap token at $PANEL_URL"
  TMP_PAYLOAD=$(mktemp)
  # No -f here. With `curl -f ... || echo 000`, -f makes curl exit non-zero
  # on HTTP 4xx/5xx, which triggered the `|| echo 000` and appended "000" to
  # whatever http_code -w already wrote, so "410" became "410000" and missed
  # the case-410 branch, falling through to "*" with a misleading "Unexpected
  # HTTP 410000". Drop -f so curl exits 0 on every reply that was actually
  # parsed (we use http_code to distinguish); the separate || fallback covers
  # only the network-down case where curl couldn't connect at all.
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
    404) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token not found at $PANEL_URL: typo or expired+purged" ;;
    410) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token already consumed or expired: issue a fresh one in the panel UI" ;;
    409) fail "The panel refused this node's core versions: $(cat "$TMP_PAYLOAD"; rm -f "$TMP_PAYLOAD"). The token is still valid." ;;
    000) rm -f "$TMP_PAYLOAD"; fail "Cannot reach panel at $PANEL_URL: check the URL, TLS cert, firewall" ;;
    *)   rm -f "$TMP_PAYLOAD"; fail "Unexpected HTTP $HTTP_CODE from panel: see panel logs" ;;
  esac
  log "Bootstrap successful: fetched ${#PAYLOAD} bytes of payload"
elif [[ -n "$BOOTSTRAP_TOKEN" || -n "$PANEL_URL" ]]; then
  fail "--panel-url and --bootstrap must be passed TOGETHER (got only one)"
fi

prompt_payload() {
  cat <<'EOF'

The panel issued a one-time base64 payload when you created this Node; it
contains the mTLS keypair. Find it in the panel UI: Nodes > Create node >
the modal that pops up after submit.

Two ways to enter it here:

  1. Paste the base64 string directly. Works only for payloads under
     ~4 KB; Linux TTY truncates longer pastes at 4096 bytes. Real
     payloads are ~6-7 KB, so this almost never works.

  2. Save the payload to a file first (download via panel UI button, or
     scp from your laptop, or `cat > /tmp/payload.b64` if your terminal
     allows). Then enter `@/path/to/file` here: the script reads the
     file content directly without any TTY buffering.

EOF
  local input
  read -rp "Payload (or @/path/to/file): " input </dev/tty || fail "no /dev/tty; pass --payload explicitly"
  PAYLOAD=$(resolve_payload "$input")
  if [[ -z "$PAYLOAD" ]]; then
    fail "empty payload"
  fi
  # Sanity-check length: real payload is base64 of a ~3 KB JSON, so >=4 KB
  # base64. Anything shorter is almost certainly truncated and we'll fail
  # later with a confusing JSON-decode error. Warn now.
  if [[ ${#PAYLOAD} -lt 4000 ]]; then
    warn "payload is only ${#PAYLOAD} chars; typical payloads are 6-7 KB."
    warn "If you pasted directly into the terminal, you likely hit the 4096-byte"
    warn "TTY paste limit. Re-run with --payload @/path/to/file for the full thing."
  fi
}

# ───── 0. Existing-install handling ─────
# Detect a prior installation. The env file is the canonical marker: if
# it's there, the agent has at least been bootstrapped against some panel
# before. Re-using it against a different (or freshly-rebuilt) panel is the
# top source of "panel can't reach node" support tickets, because the old
# server cert won't validate against the new panel CA.
EXISTING_INSTALL=0
if [[ -f /etc/iceslab-node/env || -x /usr/local/bin/iceslab-node ]]; then
  EXISTING_INSTALL=1
fi

if [[ $EXISTING_INSTALL -eq 1 ]]; then
  if [[ $RESET -eq 1 ]]; then
    log "--reset given: wiping previous installation"
    do_uninstall
  elif [[ -e /dev/tty ]]; then
    warn "Detected previous iceslab-node install on this VPS."
    warn "Re-installing against a different panel without wiping state will"
    warn "cause mTLS verification to fail (old server cert vs new panel CA)."
    # `read -rp "..." ans </dev/tty` silently lost the keypress in the
    # `bash <(curl ...)` process-substitution flow: the prompt printed but
    # the read returned empty, hitting the `*` branch with "Aborted by user"
    # even when `y` was typed. Splitting the prompt print from the read fixes
    # it, so read has /dev/tty as a clean terminal handle without the
    # prompt-print racing the input side.
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

# The cores come from --engines; --protocol (the older spelling) is optional
# and adds its core. Nothing named at all: the agent alone (25.09), no menu.
case "$PROTOCOL" in
  ""|hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru|tuic|anytls|shadowtls) ;;
  *)  fail "Unknown protocol: $PROTOCOL (valid: hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru|tuic|anytls|shadowtls)" ;;
esac
resolve_engines
LEGACY_CHECKOUT=0

step "Prerequisites"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported here" ;;
esac
ok "$PRETTY_NAME · cores: ${ENGINES[*]:-none, the agent alone}"

# RAM / swap check, same insurance as install-iceslab.sh. Go build itself is
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
    # Re-run safe: a leftover active /swapfile makes dd/fallocate fail with
    # "Text file busy". Disable + remove it first (only /swapfile, never any
    # distro-default swap like /swap.img).
    if [[ -e /swapfile ]]; then
      swapoff /swapfile 2>/dev/null || true
      rm -f /swapfile
    fi
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

# ───── network tuning (QUIC buffers + BBR) ─────
# Hysteria2 and TUIC ride QUIC over UDP; the distro-default net.core.rmem_max
# (~208 KiB) caps quic-go's receive buffer and throttles throughput on high-BDP
# (fast + distant) links, so cross-continent nodes feel slow despite headroom.
# Raise the UDP socket buffers and switch qdisc/congestion control to fq + BBR
# (also helps the TCP/REALITY paths). Idempotent drop-in, reboot-persistent;
# every step guarded so a built-in-BBR kernel or a headless box never aborts.
SYSCTL_DROPIN=/etc/sysctl.d/99-iceslab.conf
log "Tuning kernel network buffers + BBR (drop-in $SYSCTL_DROPIN)"
cat > "$SYSCTL_DROPIN" <<'EOF'
# Iceslab node network tuning. Managed by install-iceslab-node.sh.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl -p "$SYSCTL_DROPIN" >/dev/null 2>&1 || true
# default_qdisc only affects qdiscs created after this point (a reboot). Swap the
# live default-route interface to fq now so BBR is active without a reboot.
_ICE_IFACE="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
if [[ -n "$_ICE_IFACE" ]]; then
  tc qdisc replace dev "$_ICE_IFACE" root fq >/dev/null 2>&1 || true
fi
ok "network tuning applied (rmem/wmem 16 MiB, fq + BBR)"

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

# Persist `go` in PATH for future SSH sessions: symlink into /usr/local/bin
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
    log "FORCE_RESET=1: discarding local edits in $ICESLAB_NODE_DIR"
  fi
  git -C "$ICESLAB_NODE_DIR" fetch --depth 1 origin "$ICESLAB_NODE_REF"
  git -C "$ICESLAB_NODE_DIR" reset --hard "origin/$ICESLAB_NODE_REF" || true
fi

# See install-iceslab.sh for the threat model. Pin SHA for prod.
if [[ -n "${ICESLAB_NODE_REF_SHA:-}" ]]; then
  actual_sha=$(git -C "$ICESLAB_NODE_DIR" rev-parse HEAD)
  if [[ "$actual_sha" != "$ICESLAB_NODE_REF_SHA" ]]; then
    fail "ICESLAB_NODE_REF_SHA mismatch: tag $ICESLAB_NODE_REF resolved to $actual_sha, expected $ICESLAB_NODE_REF_SHA. Tag may have been re-pointed upstream; abort."
  fi
  ok "commit SHA verified ($actual_sha)"
fi

step "Build node-agent (Go, static)"
cd "$ICESLAB_NODE_DIR/apps/node"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/iceslab-node .
chmod +x /usr/local/bin/iceslab-node
ok "built /usr/local/bin/iceslab-node ($(stat -c %s /usr/local/bin/iceslab-node) bytes)"

# The core versions the panel chose for this node, as defaults for the
# bootstrap scripts below; an explicit env pair still wins.
apply_core_versions_from_payload /usr/local/bin/iceslab-node

step "Environment file (/etc/iceslab-node/env)"
ENV_DIR=/etc/iceslab-node
mkdir -p "$ENV_DIR"

# ProtectSystem=strict in our systemd unit makes /etc read-only except for
# explicit ReadWritePaths. ReadWritePaths can't create directories, only
# permit writes inside existing ones, so we pre-create every per-protocol
# config dir here, even if the protocol isn't installed on this node.
mkdir -p /etc/xray /etc/hysteria /etc/amnezia/amneziawg /etc/caddy /etc/mtg /etc/mita /etc/sing-box
ENV_FILE="$ENV_DIR/env"

# The file is written BEFORE the cores go on: every bootstrap writes its own
# block into it, and a bootstrap that finds no env file takes the machine for
# one without an agent and writes nothing. What is written here is only what
# belongs to this install: the payload, the agent's address, and the flags.
#
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
  # Zashchita (hardening): record realistic-fallback intent for the agent.
  # The agent reads REALISTIC_FALLBACK when generating the REALITY/Caddy
  # fallback so an active probe hits a real-looking site instead of a bare
  # reset. Default 0 = off.
  if [[ "$REALISTIC_FALLBACK" == "1" ]]; then
    echo "REALISTIC_FALLBACK=1" >> "$ENV_FILE"
  fi
  core_flags_env
  chmod 600 "$ENV_FILE"
else
  log "$ENV_FILE exists; keeping current payload (pass --payload to overwrite)"
fi

step "Cores (${ENGINES[*]:-none})"
# bootstrap-hysteria.sh sets up the port-hopping redirect from this.
export HYSTERIA_PORT_RANGE="$HY_PORT_RANGE"
install_engines "$ICESLAB_NODE_DIR/apps/node/scripts"
step "Firewall (ufw)"
# Allow SSH FIRST so enabling ufw can't lock us out, then per-protocol ports,
# then flip defaults to deny + enable. Skip with SKIP_FIREWALL=1.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  log "ufw: SSH + panel-mTLS:$NODE_PORT + protocol-specific"
  # SSH FIRST (the lockout-safety rule above). Zashchita: when an
  # --ssh-allowlist is given, lock 22/tcp to those IP/CIDRs only (mirror of
  # the --panel-ip loop below) instead of world-open. --harden-ufw additionally
  # rate-limits SSH (`ufw limit`) to slow brute-force scanners. The two compose:
  # allowlisted hosts still get rate-limited if both flags are set.
  if [[ -n "$SSH_ALLOWLIST" ]]; then
    log "Restricting SSH 22/tcp to SSH_ALLOWLIST=$SSH_ALLOWLIST (comma-list)"
    IFS=',' read -ra _SSH_IPS <<< "$SSH_ALLOWLIST"
    for ip in "${_SSH_IPS[@]}"; do
      [[ -z "${ip// /}" ]] && continue
      if [[ "$HARDEN_UFW" == "1" ]]; then
        ufw limit from "${ip// /}" to any port 22 proto tcp >/dev/null 2>&1 || true
      else
        ufw allow from "${ip// /}" to any port 22 proto tcp >/dev/null 2>&1 || true
      fi
    done
    unset _SSH_IPS
    # Lockout guard: if we're on an SSH session whose client IP isn't in the
    # allowlist, `ufw --force enable` below would cut THIS connection. Allow it
    # so the operator can't brick their own access; warn so a jump-host IP can
    # be removed later. (A CIDR in the list already covering it just makes this
    # a harmless extra /32 rule.)
    _CUR_SSH_IP="$(printf '%s' "${SSH_CONNECTION:-}" | awk '{print $1}')"
    _AL_NOSPACE="${SSH_ALLOWLIST// /}"
    if [[ -n "$_CUR_SSH_IP" && ",${_AL_NOSPACE}," != *",${_CUR_SSH_IP},"* ]]; then
      warn "current SSH IP ${_CUR_SSH_IP} is NOT in --ssh-allowlist; allowing it to"
      warn "avoid locking out this session. Remove later if unintended:"
      warn "  ufw delete allow from ${_CUR_SSH_IP} to any port 22 proto tcp"
      ufw allow from "${_CUR_SSH_IP}" to any port 22 proto tcp >/dev/null 2>&1 || true
    fi
  elif [[ "$HARDEN_UFW" == "1" ]]; then
    # No allowlist but hardening on: keep 22/tcp world-reachable but rate-limit
    # it so password/key brute-force probes get throttled (ufw limit = max 6
    # connections per 30s per source).
    log "Hardening SSH: rate-limiting 22/tcp (ufw limit)"
    ufw limit 22/tcp                     >/dev/null 2>&1 || true
  else
    ufw allow 22/tcp                     >/dev/null 2>&1 || true
  fi
  # Restrict mTLS port to the panel's IP if --panel-ip given, otherwise
  # (--panel-ip not set) fall back to world-open with a loud warn.
  # Resolving --panel-url's host into a candidate IP would help, but DNS
  # changes (CF rotations, panel migrations) would silently break the
  # control plane, so we make the operator type it explicitly.
  if [[ -n "$PANEL_IP" ]]; then
    log "Restricting :${NODE_PORT}/tcp to PANEL_IP=$PANEL_IP (use comma-list for multiple)"
    IFS=',' read -ra _PANEL_IPS <<< "$PANEL_IP"
    for ip in "${_PANEL_IPS[@]}"; do
      ufw allow from "${ip// /}" to any port "$NODE_PORT" proto tcp >/dev/null 2>&1 || true
    done
    unset _PANEL_IPS
  else
    warn "no --panel-ip given; mTLS port :${NODE_PORT}/tcp opened to the WORLD."
    warn "mTLS still rejects unknown clients, but you waste CPU on bot handshakes"
    warn "and leak 'this is Iceslab' via the server cert SAN. Pass --panel-ip <ip>"
    warn "next time (panel public IP) to lock it down. You can also fix it now:"
    warn "  ufw delete allow ${NODE_PORT}/tcp; ufw allow from <panel-ip> to any port ${NODE_PORT} proto tcp"
    ufw allow "${NODE_PORT}/tcp"           >/dev/null 2>&1 || true
  fi
  # Every core's ports (AmneziaWG above all: without the FORWARD policy flip
  # below its clients connect and no packet gets through), and those of
  # --protocol where an older command gave one: shadowsocks also wants 443/udp,
  # which its core, xray, does not open.
  for _FW in $PROTOCOL "${ENGINES[@]}"; do
  case "$_FW" in
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
      # 51820 deliberately NOT opened: operators who really need it can
      # `ufw allow 51820/udp` themselves. Caught live.
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ufw allow 1234/udp                 >/dev/null 2>&1 || true
      # UFW defaults DEFAULT_FORWARD_POLICY=DROP, but AmneziaWG is a routed
      # VPN: packets enter on awg0 and must FORWARD to the WAN. Without this
      # flip clients reach "Connected" and the handshake completes, but the
      # FORWARD chain silently drops their decrypted traffic. Caught live
      # on a production node.
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
      # mtg Fake-TLS handshake mimics HTTPS; TCP/443 is the canonical port.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ;;
    mieru)
      # mita supports either TCP or UDP transport per port-binding entry.
      # Allow both; firewall extras can be tightened post-install.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ;;
  esac
  done
  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable         >/dev/null
  log "ufw status: $(ufw status | head -1)"
fi

# ───── Optional: fail2ban ─────
# Zashchita (hardening): fail2ban. Gated on --fail2ban so the base install
# stays lean (fail2ban is intentionally NOT in the apt prereqs line) and an
# install without the flag (FAIL2BAN=0, the default) is byte-identical.
# Installs fail2ban + jails for sshd and the Iceslab agent's Hysteria
# auth-callback rejects (read from journald, unit iceslab-node), raising the
# cost of SSH brute-force and credential-stuffing/auth-probing.
# Emitted as a plain `log` block (NOT step()) so the [n/8] sequence is left
# untouched whether the flag is on or off.
if [[ "$FAIL2BAN" == "1" ]]; then
  log "fail2ban: installing + configuring jails (sshd + hysteria-auth)"
  # Optional hardening: never abort the node install (ERR trap + set -e) just
  # because fail2ban couldn't install. Warn and press on; the agent matters more.
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y fail2ban \
    || warn "fail2ban apt install failed; continuing (fail2ban is optional, the node agent is the priority)"

  # Custom filter for the agent's Hysteria auth-callback rejections.
  # The agent logs JSON to stdout (slog) -> journald. A rejected client
  # produces: {"...","msg":"hysteria auth rejected","addr":"<ip>:<port>"}.
  # fail2ban's systemd backend hands the filter the MESSAGE field (the JSON
  # blob), so failregex matches the addr field and <HOST> captures the IP.
  install -d -m 755 /etc/fail2ban/filter.d
  cat > /etc/fail2ban/filter.d/iceslab-hysteria.conf <<'EOF'
[Definition]
# Matches the agent's structured reject line; <HOST> is the offending IP.
# addr is "ip:port"; the optional :port is consumed by (?::\d+)?.
failregex = "msg":"hysteria auth rejected","addr":"<HOST>(?::\d+)?"
journalmatch = _SYSTEMD_UNIT=iceslab-node.service
EOF

  # jail.local override (survives package upgrades; never edit jail.conf).
  # sshd uses the distro-shipped sshd filter; hysteria uses ours. Both read
  # journald (systemd backend) so no log files need to exist (default on
  # minimal Ubuntu 24.04, which has no rsyslog/auth.log).
  install -d -m 755 /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/iceslab.local <<EOF
[DEFAULT]
backend  = systemd
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled  = true
port     = ${SSH_PORT:-22}

[iceslab-hysteria]
enabled  = true
filter   = iceslab-hysteria
maxretry = 10
findtime = 10m
bantime  = 1h
EOF

  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban \
    || warn "fail2ban restart failed; node install continues (fail2ban is optional)"
  log "fail2ban active, jails: $(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{print $2}' | xargs)"
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
# Heartbeat self-destruct exits with code 42 to signal "panel disowned this
# node, don't restart me." Any other exit (crash, panic, ENV typo, transient
# OOM-kill) goes through Restart=always as before.
RestartPreventExitStatus=42
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
# /run is needed for ufw's lockfile (/run/ufw.lock); without it the agent's
# firewall.Allow() helper crashes with "Read-only file system" because
# ProtectSystem=strict forbids /run writes by default. /run/xtables.lock
# matters too, iptables uses it from awg-quick PostUp.
# /etc/iptables/ for netfilter-persistent users (rules.v4 rewrites).
# /etc/ufw is where ufw persists user.rules/user6.rules. Without it the agent's
# firewall.AllowFrom() fails with "/etc/ufw/user.rules is not writable" and the
# allow-from-entry rule for a cascade link-in (port 24000+i) is silently
# dropped, so the entry node can't reach the exit and it shows dead in the
# observatory/balancer. Invisible on a single-node install (ports already open).
# Caught live on a production node after fresh install.
# /etc/sing-box: the sing-box adapters write their configs there (tuic,
# anytls, shadowtls, and the xray-family, hy2 and ss engines); it was missing
# from this list while every other core's directory was on it.
ReadWritePaths=-/var/log -/etc/iceslab-node -/etc/hysteria -/etc/xray -/usr/local/etc/xray -/etc/amnezia/amneziawg -/etc/caddy -/etc/mtg -/etc/mita -/var/lib/mita -/etc/sing-box -/run -/etc/iptables -/etc/ufw
PrivateTmp=true

# Journald log limits; without these a node running for months can balloon
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

# ───── 9b. Hysteria: nothing to start here ─────
# E34, 25.09 on nl-01: this step used to write /etc/hysteria/config.yaml and
# START hysteria on 443/udp before the panel had said anything. The panel did
# not know that port was taken; its first push put an AmneziaWG host on
# 443/udp, awg-quick failed with "Address already in use", and the node sat
# DEGRADED. The config and its certificate (ACME with --hysteria-domain, the
# panel's self-signed pair on an IP, E30a) are the agent's, on its first push;
# --hysteria-domain / --hysteria-email only land in the env (core_flags_env).
# The port-hopping redirect moved to bootstrap-hysteria.sh, which takes
# --hysteria-port-range as HYSTERIA_PORT_RANGE, so a hysteria added to a node
# later from the panel gets it too.
if core_ok hysteria; then
  # ⚠ Old checkout ONLY: its bootstrap-hysteria.sh installs the binary and
  # nothing else, so the unit the agent restarts comes from here. Enabled, not
  # started, and only once a config exists. Delete with legacy_primary_env.
  HY_UNIT=/etc/systemd/system/hysteria.service
  if [[ "$LEGACY_CHECKOUT" == 1 && ! -f "$HY_UNIT" ]]; then
    cat > "$HY_UNIT" <<EOF
[Unit]
Description=Hysteria 2 server (run by iceslab-node)
After=network-online.target iceslab-node.service
Wants=network-online.target
ConditionPathExists=/etc/hysteria/config.yaml

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server -c /etc/hysteria/config.yaml
Restart=always
RestartSec=5
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable hysteria.service >/dev/null 2>&1 || true
    log "Wrote $HY_UNIT (old checkout)"
  fi
  log "hysteria.service waits for its config, which the agent writes on the panel's first push"
fi

step "Wait for node-agent ready"
# Ask systemd directly: the mTLS HTTPS server rejects probes without a
# client cert, so `curl /healthz` always reports "didn't respond" even when
# the agent is healthy.
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
  ok "iceslab-node active in ${i}s; panel will poll over mTLS within ~30s"
else
  warn "iceslab-node did NOT reach active state. Check:"
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
cores_summary
printf '  Public IP    %s\n' "$PUBLIC_IP"
printf '  mTLS port    %s/tcp  (panel connects here)\n' "$NODE_PORT"
printf '  Env file     %s  (chmod 600)\n' "$ENV_FILE"
printf '\n'
printf '  Next:  panel UI > Nodes tab; status flips to "connected" in a few seconds\n'
printf '\n'
printf '  Logs       journalctl -u iceslab-node -f -o short-iso\n'
printf '  Restart    systemctl restart iceslab-node\n'
printf '  Status     systemctl status  iceslab-node\n'
printf '\n'

# The node is up and reports what it runs; a core that did not go on still
# makes the install's exit code non-zero, for whoever scripts it (E32).
if [[ ${#FAILED_ENGINES[@]} -gt 0 ]]; then
  warn "not every core went on: ${FAILED_ENGINES[*]} (see FAILED above)"
  exit 1
fi
