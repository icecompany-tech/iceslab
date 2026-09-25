#!/usr/bin/env bash
# Install the Mieru server (`mita`) on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) invokes `mita apply config <path>` and
# `mita reload` to manage user lists, which talk to a RUNNING mita: the
# package ships mita.service, and this script makes sure it is enabled and
# running rather than trusting the package's postinst. Then it writes the mita
# block of the agent's env (lib/node-env.sh), which used to be printed for the
# operator to copy (E20).
#
# Idempotent, safe to rerun: a node already on the pinned version is left alone,
# a node on any other version is moved onto it; the unit and the env block are
# seen to either way.
#
# Flags:
#   --restart-agent  restart iceslab-node at the end
#   --remove         take mita off the node instead (refused while it serves)
#
# Env overrides (both or neither: a version nobody checked has no checksum):
#   MIERU_VERSION   release to install instead of the pin, e.g. 3.37.0
#   MIERU_SHA256    sha256 of mita_<version>_<arch>.deb for this machine
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_DIR=/usr/local/bin

# Where the package put mita, which is not a promise this script makes.
wire_env() {
  node_env_block mieru \
    "MITA_BINARY=$(command -v mita 2>/dev/null || echo "$INSTALL_DIR/mita")" \
    "MITA_CONFIG=$(node_env_keep MITA_CONFIG /etc/mita/server.json)"
}

# mita.service comes with the package. Without a running mita every
# `mita apply config` the agent makes fails.
mita_unit() {
  if systemctl cat mita.service >/dev/null 2>&1; then
    systemctl enable --now mita.service >/dev/null 2>&1 || warn "could not start mita.service; check: systemctl status mita"
  else
    warn "the mita package installed no mita.service; the agent's mita calls will fail until one runs"
  fi
}

finish() {
  mkdir -p /etc/mita
  chmod 0700 /etc/mita
  mita_unit
  wire_env
  node_env_done mieru
}

unwire_env() {
  node_env_unblock mieru MITA_BINARY MITA_CONFIG MITA_PORT MITA_MTU MITA_LOG_LEVEL
}

# --remove: the mita package with its unit and its own stored config (purged),
# and the config the agent rendered. Kept: /etc/mita itself.
#
# mita.service runs whether or not the agent gave it anything, and the agent
# writes its config on every start, so neither says "serving". What does: the
# service active AND the agent's last push (the store it replays at boot)
# naming a mieru inbound.
remove_core() {
  local config running="" store=/etc/iceslab-node/inbounds.json
  config="$(node_env_keep MITA_CONFIG /etc/mita/server.json)"
  if systemctl is-active --quiet mita.service 2>/dev/null && grep -Eq '"protocol": *"mieru"' "$store" 2>/dev/null; then
    running="mita.service is active and the agent's last push names a mieru inbound"
  fi
  node_env_refuse_if_running mita "$running"
  systemctl disable --now mita.service >/dev/null 2>&1 || true
  if dpkg -s mita >/dev/null 2>&1; then
    dpkg -P mita >/dev/null || warn "dpkg -P mita failed; check: dpkg -s mita"
  fi
  rm -f "$INSTALL_DIR/mita" "$config"
  unwire_env
  log "mita removed"
}

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  remove_core
  node_env_done mieru
  exit 0
fi

# ───── pinned version ─────
#
# Same story as mtg: this used to take GitHub's `latest` and skip any node that
# already had a mita, so the fleet drifted by install date. Pinned, and the
# package is checked against the sha256 the release published. The pin, the
# file per arch and its sha256 come from the version manifest
# (packages/shared/src/core-versions.ts), in the block below. Upstream ships no
# armv7 package, which is why that entry is empty.
# >>> core-pins:mita >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
MIERU_PINNED_VERSION="3.37.0"
MIERU_PINNED_TAG="v3.37.0"
declare -A MIERU_PINNED_FILE=(
  [amd64]="mita_3.37.0_amd64.deb"
  [arm64]="mita_3.37.0_arm64.deb"
  [armv7]=""
)
declare -A MIERU_PINNED_SHA256=(
  [amd64]="22248dc1568280a8b1bdaf55051a59b3d64ac1edb4ec4918e3925088f78a35de"
  [arm64]="d82a7d3c76e8dad42c2736955c5c08ad7ad8f99cafefe2ef4cd1f497ec8d3caa"
  [armv7]=""
)
# <<< core-pins:mita <<<

if [[ -n "${MIERU_VERSION:-}" && -z "${MIERU_SHA256:-}" ]] || [[ -z "${MIERU_VERSION:-}" && -n "${MIERU_SHA256:-}" ]]; then
  fail "MIERU_VERSION and MIERU_SHA256 go together: a version without its checksum is not installed"
fi
MIERU_VERSION="${MIERU_VERSION:-$MIERU_PINNED_VERSION}"
MIERU_VERSION="${MIERU_VERSION#v}"

# ───── What is installed ─────
#
# E31, 25.09 on nl-01 (Ubuntu 26.04): dpkg installed mita 3.37.0, mita.service
# was active, and the smoke test said "installed mita reports 'nothing'". It
# asked $INSTALL_DIR/mita, /usr/local/bin, and the package puts mita in
# /usr/bin: the binary asked was never there. So the version is read where the
# package keeps it, the package database, and `mita version` only confirms.

# Where mita is: wherever the package put it (the agent's env says the same).
mita_bin() { command -v mita 2>/dev/null || echo "$INSTALL_DIR/mita"; }

# The installed version by dpkg, epoch and Debian revision stripped: "3.37.0".
# Empty when the package is not installed.
installed_version() {
  local v
  v=$(dpkg-query -W -f='${Version}' mita 2>/dev/null || true)
  v="${v#*:}"
  printf '%s' "${v%%-*}"
}

# What the binary says, the first x.y.z in `mita version`, retried for up to
# MITA_VERSION_WAIT seconds (10): mita is a client of its own daemon, and right
# after the package starts mita.service the answer may not be there yet.
binary_version() {
  local bin i out
  bin=$(mita_bin)
  for ((i = 0; i < ${MITA_VERSION_WAIT:-10}; i++)); do
    out=$("$bin" version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
}

# ───── 1. Already on the wanted version? ─────
CURRENT=$(installed_version)
if [[ -n "$CURRENT" ]]; then
  if [[ "$CURRENT" == "$MIERU_VERSION" ]]; then
    log "mita $CURRENT is already installed, which is the wanted version"
    finish
    exit 0
  fi
  log "mita $CURRENT is installed, moving it to $MIERU_VERSION"
fi

# ───── 2. Detect arch ─────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  M_ARCH="amd64" ;;
  aarch64) M_ARCH="arm64" ;;
  *)       fail "Unsupported architecture: $ARCH (upstream ships mita for amd64 and arm64)" ;;
esac
log "Detected arch: $ARCH → $M_ARCH"
WANT_SHA="${MIERU_SHA256:-${MIERU_PINNED_SHA256[$M_ARCH]:-}}"
[[ -n "$WANT_SHA" ]] || fail "no pinned checksum for mita $MIERU_VERSION on $M_ARCH"
# The pinned file for this arch, with the version swapped in for an override.
DEB="${MIERU_PINNED_FILE[$M_ARCH]:-}"
[[ -n "$DEB" ]] || fail "upstream ships no mita for $M_ARCH"
DEB="${DEB//"$MIERU_PINNED_VERSION"/$MIERU_VERSION}"

# ───── 3. Download and check the .deb (mita ships as a Debian package) ─────
DOWNLOAD_URL="https://github.com/enfein/mieru/releases/download/${MIERU_PINNED_TAG//"$MIERU_PINNED_VERSION"/$MIERU_VERSION}/${DEB}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

log "Downloading $DOWNLOAD_URL"
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMPDIR/$DEB" || fail "download failed: $DOWNLOAD_URL"
GOT_SHA=$(sha256sum "$TMPDIR/$DEB" | awk '{print $1}')
[[ "$GOT_SHA" == "$WANT_SHA" ]] || fail "checksum mismatch for $DEB: got $GOT_SHA, expected $WANT_SHA"
log "Checksum OK ($GOT_SHA)"

# ───── 4. Install via dpkg ─────
log "Installing $DEB via dpkg..."
dpkg -i "$TMPDIR/$DEB" || {
  warn "dpkg returned non-zero, running apt-get install -f to fix deps"
  apt-get install -f -y
}

# ───── 5. Smoke-test ─────
# The package database is the fact; the binary only confirms. A binary that
# names ANOTHER version is a refusal; one that says nothing in time is a
# warning, because what dpkg installed is what the node has.
VERSION=$(installed_version)
[[ "$VERSION" == "$MIERU_VERSION" ]] || fail "dpkg has mita '${VERSION:-not installed}', expected $MIERU_VERSION"
SAYS=$(binary_version)
if [[ -z "$SAYS" ]]; then
  warn "$(mita_bin) version printed no version within ${MITA_VERSION_WAIT:-10}s; dpkg has mita $VERSION, going on"
elif [[ "$SAYS" != "$MIERU_VERSION" ]]; then
  fail "dpkg has mita $VERSION, but $(mita_bin) says $SAYS: another mita is first on PATH"
fi
log "Smoke-test passed: mita $VERSION"

# ───── 6. /etc/mita (node-agent writes server.json there), unit, agent env ─────
finish
log "mita $VERSION is ready"
