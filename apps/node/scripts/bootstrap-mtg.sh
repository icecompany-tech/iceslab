#!/usr/bin/env bash
# Install the mtg (9seconds/mtg) MTProto-proxy binary on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) spawns mtg as a child process when MTG_BINARY
# is set, so there is no unit to write. This script places the binary at
# /usr/local/bin/mtg, verifies it, and writes the mtg block of the agent's env
# (lib/node-env.sh), which used to be printed for the operator to copy (E20).
#
# Idempotent, safe to rerun: a node already on the pinned version is left alone,
# a node on any other version is moved onto it; the env block is written either
# way.
#
# Flags:
#   --restart-agent  restart iceslab-node at the end
#   --remove         take mtg off the node instead (refused while it runs)
#
# Env overrides (both or neither: a version nobody checked has no checksum):
#   MTG_VERSION   release to install instead of the pin, e.g. 2.2.8
#   MTG_SHA256    sha256 of mtg-<version>-linux-<arch>.tar.gz for this machine
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/mtg

# Port, stats port and the Fake-TLS domain have defaults in the agent and come
# from the panel's push; only what registers the adapter is written here.
wire_env() {
  node_env_block mtproto \
    "MTG_BINARY=$INSTALL_PATH" \
    "MTG_CONFIG=$(node_env_keep MTG_CONFIG /etc/mtg/config.toml)"
}

unwire_env() {
  node_env_unblock mtproto MTG_BINARY MTG_CONFIG MTG_PORT MTG_STATS_PORT MTG_DOMAIN
}

# --remove: the binary and the config the agent rendered. Kept: /etc/mtg
# itself, which the agent's unit lists as writable.
remove_core() {
  local config
  config="$(node_env_keep MTG_CONFIG /etc/mtg/config.toml)"
  node_env_refuse_if_running mtg "$(node_env_pids mtg)"
  rm -f "$INSTALL_PATH" "$config"
  unwire_env
  log "mtg removed"
}

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  remove_core
  node_env_done mtproto
  exit 0
fi

# ───── pinned version ─────
#
# This script used to install whatever GitHub called `latest` the minute it ran,
# and to skip any node that already had some mtg, so a fleet held as many mtg
# releases as it had install dates and nothing said which. The version is now a
# decision in the repository, and the tarball is checked against the sha256 the
# release published. The pin, the file per arch and its sha256 come from the
# version manifest (packages/shared/src/core-versions.ts), in the block below.
# >>> core-pins:mtg >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
MTG_PINNED_VERSION="2.2.8"
MTG_PINNED_TAG="v2.2.8"
declare -A MTG_PINNED_FILE=(
  [amd64]="mtg-2.2.8-linux-amd64.tar.gz"
  [arm64]="mtg-2.2.8-linux-arm64.tar.gz"
  [armv7]="mtg-2.2.8-linux-armv7.tar.gz"
)
declare -A MTG_PINNED_SHA256=(
  [amd64]="7ef19d079d85f4e00d4f8334ec1f3f3c8718e3d0ed1f3109ea9a8673138a2102"
  [arm64]="562a94dd4cafcb8f179b76cfeafb76da12747c8e230bc76235bf8746cc189644"
  [armv7]="494ee3794ed00201e5333b478236ce2f434b33f2d3445f227debe9fc386bbef0"
)
# <<< core-pins:mtg <<<

if [[ -n "${MTG_VERSION:-}" && -z "${MTG_SHA256:-}" ]] || [[ -z "${MTG_VERSION:-}" && -n "${MTG_SHA256:-}" ]]; then
  fail "MTG_VERSION and MTG_SHA256 go together: a version without its checksum is not installed"
fi
MTG_VERSION="${MTG_VERSION:-$MTG_PINNED_VERSION}"
MTG_VERSION="${MTG_VERSION#v}"

# What a binary says it is: `mtg --version` starts with the bare version,
# "2.2.8 (go1.26.1: ...)". awk reads to the end so pipefail cannot kill the
# script on an early SIGPIPE.
version_of() {
  "$1" --version 2>/dev/null | awk 'NR == 1 { v = $1 } END { print v }'
}

# ───── 1. Already on the wanted version? ─────
if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$(version_of "$INSTALL_PATH" || true)
  if [[ "$CURRENT" == "$MTG_VERSION" ]]; then
    log "mtg $CURRENT is already installed, which is the wanted version"
    wire_env
    node_env_done mtproto
    exit 0
  fi
  log "mtg ${CURRENT:-unknown} is installed, moving it to $MTG_VERSION"
fi

# ───── 2. Detect arch ─────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  MTG_ARCH="amd64" ;;
  aarch64) MTG_ARCH="arm64" ;;
  armv7l)  MTG_ARCH="armv7" ;;
  *)       fail "Unsupported architecture: $ARCH" ;;
esac
log "Detected arch: $ARCH → $MTG_ARCH"
WANT_SHA="${MTG_SHA256:-${MTG_PINNED_SHA256[$MTG_ARCH]:-}}"
[[ -n "$WANT_SHA" ]] || fail "no pinned checksum for mtg $MTG_VERSION on $MTG_ARCH"
# The pinned file for this arch, with the version swapped in for an override:
# upstream's naming, arch spelling included, comes from the manifest.
TARBALL="${MTG_PINNED_FILE[$MTG_ARCH]:-}"
[[ -n "$TARBALL" ]] || fail "upstream ships no mtg for $MTG_ARCH"
TARBALL="${TARBALL//"$MTG_PINNED_VERSION"/$MTG_VERSION}"

# ───── 3. Download and check ─────
DOWNLOAD_URL="https://github.com/9seconds/mtg/releases/download/${MTG_PINNED_TAG//"$MTG_PINNED_VERSION"/$MTG_VERSION}/${TARBALL}"
log "Downloading $DOWNLOAD_URL"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMPDIR/$TARBALL" || fail "download failed: $DOWNLOAD_URL"
GOT_SHA=$(sha256sum "$TMPDIR/$TARBALL" | awk '{print $1}')
[[ "$GOT_SHA" == "$WANT_SHA" ]] || fail "checksum mismatch for $TARBALL: got $GOT_SHA, expected $WANT_SHA"
log "Checksum OK ($GOT_SHA)"
tar -xzf "$TMPDIR/$TARBALL" -C "$TMPDIR"

# Find the mtg binary inside the extracted tree (release layout has changed).
BIN=$(find "$TMPDIR" -type f -name mtg -perm -u+x | head -1)
[[ -n "$BIN" ]] || fail "mtg binary not found in extracted tarball"

# ───── 4. Smoke-test ─────
# It has to say it is the version we asked for, or it does not get installed.
VERSION=$(version_of "$BIN" || true)
[[ "$VERSION" == "$MTG_VERSION" ]] || fail "downloaded binary reports '${VERSION:-nothing}', expected $MTG_VERSION"
log "Smoke-test passed: mtg $VERSION"

# ───── 5. Install ─────
mv "$BIN" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
log "Installed to $INSTALL_PATH"

# ───── 6. /etc/mtg dir ─────
mkdir -p /etc/mtg
chmod 0700 /etc/mtg
log "Created /etc/mtg (mode 0700; node-agent will populate config.toml on ApplyInbound)"

# ───── 7. Agent env ─────
wire_env
node_env_done mtproto
log "mtg $VERSION is ready at $INSTALL_PATH"
