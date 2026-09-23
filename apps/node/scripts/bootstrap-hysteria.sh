#!/usr/bin/env bash
# Install the Hysteria 2 binary on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) spawns hysteria as a child process, so no
# separate systemd unit is needed. This script only places the binary at
# /usr/local/bin/hysteria and verifies it works.
#
# Idempotent, safe to rerun: a node already on the pinned version is left alone,
# a node on any other version is moved onto it.
#
# Env overrides (both or neither: a version nobody checked has no checksum):
#   HYSTERIA_VERSION  release to install instead of the pin, e.g. 2.12.3
#   HYSTERIA_SHA256   sha256 of hysteria-linux-<arch> of that release
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/hysteria

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
    echo
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

# ───── 6. Summary ─────
echo
log "Hysteria 2 is ready."
echo "    Binary:  $INSTALL_PATH"
echo "    Version: $VERSION"
echo
echo "Set HYSTERIA_BINARY=$INSTALL_PATH in the node-agent env file:"
echo "    /etc/iceslab-node/env"
echo "Then restart: systemctl restart iceslab-node"
