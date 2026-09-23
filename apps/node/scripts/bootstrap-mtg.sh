#!/usr/bin/env bash
# Install the mtg (9seconds/mtg) MTProto-proxy binary on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) spawns mtg as a child process when MTG_BINARY
# is set. This script only places the binary at /usr/local/bin/mtg and verifies
# it works.
#
# Idempotent, safe to rerun: a node already on the pinned version is left alone,
# a node on any other version is moved onto it.
#
# Env overrides (both or neither: a version nobody checked has no checksum):
#   MTG_VERSION   release to install instead of the pin, e.g. 2.2.8
#   MTG_SHA256    sha256 of mtg-<version>-linux-<arch>.tar.gz for this machine
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/mtg

# ───── pinned version ─────
#
# This script used to install whatever GitHub called `latest` the minute it ran,
# and to skip any node that already had some mtg, so a fleet held as many mtg
# releases as it had install dates and nothing said which. The version is now a
# decision in the repository, and the tarball is checked against the sha256 the
# release published (GitHub asset digest, recomputed by hand on 2026-09-23).
MTG_PINNED_VERSION="2.2.8"
declare -A MTG_PINNED_SHA256=(
  [amd64]="7ef19d079d85f4e00d4f8334ec1f3f3c8718e3d0ed1f3109ea9a8673138a2102"
  [arm64]="562a94dd4cafcb8f179b76cfeafb76da12747c8e230bc76235bf8746cc189644"
  [armv7]="494ee3794ed00201e5333b478236ce2f434b33f2d3445f227debe9fc386bbef0"
)

if [[ -n "${MTG_VERSION:-}" && -z "${MTG_SHA256:-}" ]] || [[ -z "${MTG_VERSION:-}" && -n "${MTG_SHA256:-}" ]]; then
  fail "MTG_VERSION and MTG_SHA256 go together: a version without its checksum is not installed"
fi
MTG_VERSION="${MTG_VERSION:-$MTG_PINNED_VERSION}"

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

# ───── 3. Download and check ─────
TARBALL="mtg-${MTG_VERSION}-linux-${MTG_ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/9seconds/mtg/releases/download/v${MTG_VERSION}/${TARBALL}"
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

# ───── 7. Summary ─────
echo
log "mtg is ready."
echo "    Binary:  $INSTALL_PATH"
echo "    Version: $VERSION"
echo
echo "Set the following in /etc/iceslab-node/env then restart node-agent:"
echo "    MTG_BINARY=$INSTALL_PATH"
echo "    MTG_CONFIG=/etc/mtg/config.toml"
echo "    MTG_PORT=443"
echo "    MTG_DOMAIN=www.cloudflare.com   # optional pre-seed; panel can override"
echo "Then: systemctl restart iceslab-node"
