#!/usr/bin/env bash
# Install Hysteria 2 on an Ubuntu/Debian VPS and wire it into the node-agent.
#
#   - places the pinned, checked binary at /usr/local/bin/hysteria;
#   - writes /etc/systemd/system/hysteria.service. The agent runs hysteria
#     through it (HYSTERIA_SERVICE_UNIT): it writes the config and restarts
#     the unit on every push. The unit starts only once a config exists, so a
#     node waiting for its first push does not crash-loop;
#   - writes the hysteria block of the agent's env (lib/node-env.sh): binary,
#     config, auth callback port, the unit, and the traffic-stats listener and
#     secret. The secret is kept across runs: the config on disk carries it.
#
# E20, stand 2026-09-24: all of the above but the binary used to be done only
# by install-iceslab-node.sh for --protocol hysteria, so hysteria added to a
# node later was a binary the agent never used.
#
# Idempotent, safe to rerun: a node already on the pinned version keeps its
# binary, a node on any other version is moved onto it; the unit and the env
# block are written either way.
#
# Flags:
#   --restart-agent  restart iceslab-node at the end
#   --remove         take hysteria off the node instead (refused while it runs)
#
# Env overrides (both or neither: a version nobody checked has no checksum):
#   HYSTERIA_VERSION  release to install instead of the pin, e.g. 2.12.3
#   HYSTERIA_SHA256   sha256 of hysteria-linux-<arch> of that release
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/hysteria
HYSTERIA_CONFIG_PATH=/etc/hysteria/config.yaml
HYSTERIA_UNIT=/etc/systemd/system/hysteria.service

# The six the agent needs, and nothing that belongs to one install (hostname,
# ACME e-mail: install-iceslab-node.sh writes those from its own flags, and
# the panel pushes the hostname anyway).
wire_env() {
  local secret
  secret="$(node_env_keep HYSTERIA_STATS_SECRET "")"
  if [[ -z "$secret" ]]; then
    secret="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  node_env_block hysteria \
    "HYSTERIA_BINARY=$INSTALL_PATH" \
    "HYSTERIA_CONFIG=$HYSTERIA_CONFIG_PATH" \
    "HYSTERIA_AUTH_PORT=$(node_env_keep HYSTERIA_AUTH_PORT 9000)" \
    "HYSTERIA_SERVICE_UNIT=hysteria" \
    "HYSTERIA_STATS_LISTEN=$(node_env_keep HYSTERIA_STATS_LISTEN 127.0.0.1:9999)" \
    "HYSTERIA_STATS_SECRET=$secret"
}

# The unit the agent restarts. Rewritten only when it differs, so a rerun does
# not reload systemd for nothing. Enabled, not started: without a config it has
# nothing to run, and the agent's first push starts it.
write_unit() {
  local want
  want="$(cat <<EOF
[Unit]
Description=Hysteria 2 server (run by iceslab-node)
After=network-online.target iceslab-node.service
Wants=network-online.target
ConditionPathExists=${HYSTERIA_CONFIG_PATH}

[Service]
Type=simple
ExecStart=${INSTALL_PATH} server -c ${HYSTERIA_CONFIG_PATH}
Restart=always
RestartSec=5
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
)"
  mkdir -p "$(dirname "$HYSTERIA_CONFIG_PATH")"
  if [[ ! -f "$HYSTERIA_UNIT" ]] || [[ "$(cat "$HYSTERIA_UNIT")" != "$want" ]]; then
    printf '%s\n' "$want" >"$HYSTERIA_UNIT"
    systemctl daemon-reload
    log "Wrote $HYSTERIA_UNIT"
  fi
  systemctl enable hysteria.service >/dev/null 2>&1 || warn "could not enable hysteria.service"
  # Upstream's own units, if an older install left them: a second hysteria on
  # the same port is what "address already in use" looks like.
  systemctl disable --now hysteria-server.service >/dev/null 2>&1 || true
}

finish() {
  write_unit
  wire_env
  node_env_done hysteria
}

unwire_env() {
  node_env_unblock hysteria HYSTERIA_BINARY HYSTERIA_CONFIG HYSTERIA_AUTH_PORT HYSTERIA_SERVICE_UNIT \
    HYSTERIA_STATS_LISTEN HYSTERIA_STATS_SECRET HYSTERIA_AUTH_HOST HYSTERIA_HOSTNAME HYSTERIA_ACME_EMAIL
}

# --remove: the binary, hysteria.service, the config the agent rendered, the
# port-hopping redirect the installer set up for hysteria, and upstream's units
# if an older install left them. Kept: anything else under /etc/hysteria, and
# hysteria's ACME storage wherever it put it, so a reinstall need not ask
# Let's Encrypt again.
remove_core() {
  local running=""
  systemctl is-active --quiet hysteria.service 2>/dev/null && running="hysteria.service is active"
  [[ -n "$running" ]] || running="$(node_env_pids hysteria)"
  node_env_refuse_if_running hysteria "$running"
  systemctl disable hysteria.service >/dev/null 2>&1 || true
  systemctl disable --now hysteria-server.service iceslab-hyhop.service >/dev/null 2>&1 || true
  rm -f "$HYSTERIA_UNIT" /etc/systemd/system/iceslab-hyhop.service /usr/local/bin/iceslab-hyhop
  rm -rf /etc/systemd/system/hysteria.service.d
  rm -f "$INSTALL_PATH" "$HYSTERIA_CONFIG_PATH"
  systemctl daemon-reload >/dev/null 2>&1 || true
  unwire_env
  log "hysteria removed (the rest of $(dirname "$HYSTERIA_CONFIG_PATH") and its ACME storage kept)"
}

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  remove_core
  node_env_done hysteria
  exit 0
fi

# ───── pinned version ─────
#
# The version a node gets is a decision, not whatever GitHub answered the
# minute somebody ran the installer. This script used to resolve `latest`, and
# was the ONLY engine installer here that did: sing-box and xray were pinned,
# hysteria moved under the fleet on its own. A fleet installed across two weeks
# ended up on two engines, and a config correct on one node could be refused
# on the next with nothing anywhere saying why.
#
# It matters more from phase 6 on: the agent renders the hysteria config that
# hands users to the chain (a socks5 outbound, and no acl), and that shape was
# MEASURED against the pinned release, not read from documentation. Moving the
# pin is a change in the version manifest (packages/shared/src/core-versions.ts)
# with the same measurement behind it; the block below is generated from it.
#
# `latest` is gone: the binary is now checked against a sha256, and a release
# resolved on the day has none to check against.
# >>> core-pins:hysteria >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
HYSTERIA_PINNED_VERSION="2.12.3"
HYSTERIA_PINNED_TAG="app/v2.12.3"
declare -A HYSTERIA_PINNED_FILE=(
  [amd64]="hysteria-linux-amd64"
  [arm64]="hysteria-linux-arm64"
  [armv7]="hysteria-linux-arm"
)
declare -A HYSTERIA_PINNED_SHA256=(
  [amd64]="8c7a68a906998b747a0db87586e364f995fbfddb95693ae6e2fdb68a6e920d3e"
  [arm64]="c8dc653c3ba0a28d29a26b8fa52d2086f27c0927afddce95c09965e7174e78b0"
  [armv7]="cc4bc596c2db473dd7ec1bbcc3cd10e0cb60302759facd95e0be73bc8751e110"
)
# <<< core-pins:hysteria <<<

if [[ -n "${HYSTERIA_VERSION:-}" && -z "${HYSTERIA_SHA256:-}" ]] || [[ -z "${HYSTERIA_VERSION:-}" && -n "${HYSTERIA_SHA256:-}" ]]; then
  fail "HYSTERIA_VERSION and HYSTERIA_SHA256 go together: a version without its checksum is not installed"
fi
HYSTERIA_VERSION="${HYSTERIA_VERSION:-$HYSTERIA_PINNED_VERSION}"
HYSTERIA_VERSION="${HYSTERIA_VERSION#v}"

# What a binary says it is. Read from its own `Version:` line rather than the
# first v-number in the output: `hysteria version` also prints the versions of
# its libraries (quic-go and friends), and the first match is not a promise
# about which one comes first.
#
# awk reads to the END instead of exiting on the match. Under `pipefail` an
# early exit can close the pipe while hysteria is still writing, the writer
# dies of SIGPIPE, and `set -e` then kills this script on a plain assignment.
version_of() {
  "$1" version 2>/dev/null | awk '/^Version:/ && !v { v = $2 } END { print v }'
}

# ───── 1. Already on the wanted version? ─────
# `hysteria version` says "v2.12.3"; the manifest keeps the bare number.
if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$(version_of "$INSTALL_PATH" || true)
  if [[ "${CURRENT#v}" == "$HYSTERIA_VERSION" ]]; then
    log "hysteria $CURRENT is already installed, which is the wanted version"
    finish
    log "hysteria is ready at $INSTALL_PATH"
    exit 0
  fi
  # Not skipped any more, and deliberately: a node that kept whatever version it
  # was first given is exactly the drift the pin exists to end.
  log "hysteria ${CURRENT:-unknown} is installed, moving it to $HYSTERIA_VERSION"
fi

# ───── 2. Detect arch ─────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  HY_ARCH="amd64" ;;
  aarch64) HY_ARCH="arm64" ;;
  armv7l)  HY_ARCH="armv7" ;;
  *)       fail "Unsupported architecture: $ARCH" ;;
esac
log "Detected arch: $ARCH → $HY_ARCH"
WANT_SHA="${HYSTERIA_SHA256:-${HYSTERIA_PINNED_SHA256[$HY_ARCH]:-}}"
[[ -n "$WANT_SHA" ]] || fail "no pinned checksum for hysteria $HYSTERIA_VERSION on $HY_ARCH"
# The file name is the manifest's: upstream calls its armv7 build
# hysteria-linux-arm, and this script used to ask for hysteria-linux-armv7,
# which does not exist, so every armv7 install died on a 404.
ASSET="${HYSTERIA_PINNED_FILE[$HY_ARCH]:-}"
[[ -n "$ASSET" ]] || fail "upstream ships no hysteria for $HY_ARCH"

# ───── 3. Download and check the wanted release ─────
# Releases are tagged `app/vX.Y.Z` upstream, hence the escaped slash.
TAG="${HYSTERIA_PINNED_TAG//"$HYSTERIA_PINNED_VERSION"/$HYSTERIA_VERSION}"
DOWNLOAD_URL="https://github.com/apernet/hysteria/releases/download/${TAG//\//%2F}/${ASSET}"
log "Downloading hysteria $HYSTERIA_VERSION from $DOWNLOAD_URL"

TMP=$(mktemp)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP" || { rm -f "$TMP"; fail "download failed: $DOWNLOAD_URL"; }
GOT_SHA=$(sha256sum "$TMP" | awk '{print $1}')
[[ "$GOT_SHA" == "$WANT_SHA" ]] \
  || { rm -f "$TMP"; fail "checksum mismatch for $ASSET: got $GOT_SHA, expected $WANT_SHA"; }
log "Checksum OK ($GOT_SHA)"
chmod +x "$TMP"

# ───── 4. Smoke-test ─────
# The binary has to say it is the version we asked for, or it does not get
# installed.
VERSION=$(version_of "$TMP" || true)
[[ "${VERSION#v}" == "$HYSTERIA_VERSION" ]] \
  || { rm -f "$TMP"; fail "downloaded binary reports '${VERSION:-nothing}', expected $HYSTERIA_VERSION"; }
log "Downloaded hysteria $VERSION, OK"

# ───── 5. Install ─────
mv "$TMP" "$INSTALL_PATH"
log "Installed to $INSTALL_PATH"

# ───── 6. Unit and agent env ─────
finish
log "Hysteria 2 $VERSION is ready at $INSTALL_PATH"
