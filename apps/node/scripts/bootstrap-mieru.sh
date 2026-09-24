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

# `mita version` prints the bare version, "3.37.0".
version_of() {
  "$1" version 2>/dev/null | awk 'NR == 1 { v = $1 } END { print v }'
}

# ───── 1. Already on the wanted version? ─────
if [[ -x "$INSTALL_DIR/mita" ]]; then
  CURRENT=$(version_of "$INSTALL_DIR/mita" || true)
  if [[ "$CURRENT" == "$MIERU_VERSION" ]]; then
    log "mita $CURRENT is already installed, which is the wanted version"
    finish
    exit 0
  fi
  log "mita ${CURRENT:-unknown} is installed, moving it to $MIERU_VERSION"
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
VERSION=$(version_of "$INSTALL_DIR/mita" || true)
[[ "$VERSION" == "$MIERU_VERSION" ]] || fail "installed mita reports '${VERSION:-nothing}', expected $MIERU_VERSION"
log "Smoke-test passed: mita $VERSION"

# ───── 6. /etc/mita (node-agent writes server.json there), unit, agent env ─────
finish
log "mita $VERSION is ready"
