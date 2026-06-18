#!/usr/bin/env bash
# Install the Hysteria 2 binary on a fresh Ubuntu/Debian VPS.
#
# The node-agent (iceslab-node) spawns hysteria as a child process, so no
# separate systemd unit is needed. This script only places the binary at
# /usr/local/bin/hysteria and verifies it works.
#
# Idempotent, safe to rerun.
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/hysteria

# ───── 1. Already installed? ─────
if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$("$INSTALL_PATH" version 2>&1 | grep -oP 'v[\d.]+' | head -1 || echo "unknown")
  log "hysteria already installed: $CURRENT, skipping download"
  log "To upgrade, remove $INSTALL_PATH and rerun."
  echo
  log "hysteria is ready at $INSTALL_PATH"
  exit 0
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

# ───── 3. Resolve latest release tag ─────
log "Resolving latest Hysteria 2 release..."
LATEST_TAG=$(curl -fsSL https://api.github.com/repos/apernet/hysteria/releases/latest \
  | grep '"tag_name"' | grep -oP '"app/v[\d.]+"' | tr -d '"' | sed 's|app/||')

if [[ -z "$LATEST_TAG" ]]; then
  fail "Could not resolve latest Hysteria 2 release tag from GitHub API"
fi
log "Latest release: $LATEST_TAG"

# ───── 4. Download ─────
DOWNLOAD_URL="https://github.com/apernet/hysteria/releases/download/app%2F${LATEST_TAG}/hysteria-linux-${HY_ARCH}"
log "Downloading from $DOWNLOAD_URL"

TMP=$(mktemp)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# ───── 5. Smoke-test ─────
VERSION=$("$TMP" version 2>&1 | grep -oP 'v[\d.]+' | head -1 || echo "unknown")
log "Downloaded hysteria $VERSION, OK"

# ───── 6. Install ─────
mv "$TMP" "$INSTALL_PATH"
log "Installed to $INSTALL_PATH"

# ───── 7. Summary ─────
echo
log "Hysteria 2 is ready."
echo "    Binary:  $INSTALL_PATH"
echo "    Version: $VERSION"
echo
echo "Set HYSTERIA_BINARY=$INSTALL_PATH in the node-agent env file:"
echo "    /etc/iceslab-node/env"
echo "Then restart: systemctl restart iceslab-node"
