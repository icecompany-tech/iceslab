#!/usr/bin/env bash
# Install the mtg (9seconds/mtg) MTProto-proxy binary on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) spawns mtg as a child process when MTG_BINARY
# is set. This script only places the binary at /usr/local/bin/mtg and verifies
# it works.
#
# Idempotent, safe to rerun.
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/mtg

# ───── 1. Already installed? ─────
if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$("$INSTALL_PATH" --version 2>&1 | head -1 || echo "unknown")
  log "mtg already installed: $CURRENT, skipping download"
  log "To upgrade, remove $INSTALL_PATH and rerun."
  exit 0
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

# ───── 3. Resolve latest release tag ─────
log "Resolving latest mtg release..."
LATEST_TAG=$(curl -fsSL https://api.github.com/repos/9seconds/mtg/releases/latest \
  | grep '"tag_name"' | head -1 | sed -E 's/.*"v?([^"]+)".*/\1/')

if [[ -z "$LATEST_TAG" ]]; then
  fail "Could not resolve latest mtg release tag from GitHub API"
fi
log "Latest release: v$LATEST_TAG"

# ───── 4. Download tarball ─────
TARBALL="mtg-${LATEST_TAG}-linux-${MTG_ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/9seconds/mtg/releases/download/v${LATEST_TAG}/${TARBALL}"
log "Downloading $DOWNLOAD_URL"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMPDIR/$TARBALL"
tar -xzf "$TMPDIR/$TARBALL" -C "$TMPDIR"

# Find the mtg binary inside the extracted tree (release layout has changed).
BIN=$(find "$TMPDIR" -type f -name mtg -perm -u+x | head -1)
[[ -n "$BIN" ]] || fail "mtg binary not found in extracted tarball"

# ───── 5. Smoke-test ─────
"$BIN" --version >/dev/null 2>&1 || fail "smoke test failed"
log "Smoke-test passed"

# ───── 6. Install ─────
mv "$BIN" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
log "Installed to $INSTALL_PATH"

# ───── 7. /etc/mtg dir ─────
mkdir -p /etc/mtg
chmod 0700 /etc/mtg
log "Created /etc/mtg (mode 0700; node-agent will populate config.toml on ApplyInbound)"

# ───── 8. Summary ─────
echo
log "mtg is ready."
echo "    Binary:  $INSTALL_PATH"
echo "    Version: $LATEST_TAG"
echo
echo "Set the following in /etc/iceslab-node/env then restart node-agent:"
echo "    MTG_BINARY=$INSTALL_PATH"
echo "    MTG_CONFIG=/etc/mtg/config.toml"
echo "    MTG_PORT=443"
echo "    MTG_DOMAIN=www.cloudflare.com   # optional pre-seed; panel can override"
echo "Then: systemctl restart iceslab-node"
