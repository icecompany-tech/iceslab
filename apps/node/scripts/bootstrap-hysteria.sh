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
# Env overrides:
#   HYSTERIA_VERSION  release to install (default: the pinned one below, or the
#                     literal `latest` to resolve the newest release on purpose)
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
# MEASURED against 2.12.3 on 2026-09-23, not read from documentation. Moving the
# pin is a change in the repository with the same measurement behind it.
#
# Pass HYSTERIA_VERSION=latest to resolve the newest release on purpose, which
# is a thing you may want on a throwaway box and never on the fleet.
HYSTERIA_PINNED_VERSION="v2.12.3"
HYSTERIA_VERSION="${HYSTERIA_VERSION:-$HYSTERIA_PINNED_VERSION}"

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
# Only the literal `latest` asks GitHub, and it is resolved before this check so
# that "already on latest" means what it says.
if [[ "$HYSTERIA_VERSION" == "latest" ]]; then
  log "Resolving latest Hysteria 2 release (asked for explicitly)..."
  HYSTERIA_VERSION=$(curl -fsSL https://api.github.com/repos/apernet/hysteria/releases/latest \
    | grep '"tag_name"' | grep -oP '"app/v[\d.]+"' | tr -d '"' | sed 's|app/||')
  [[ -n "$HYSTERIA_VERSION" ]] || fail "Could not resolve latest release (set HYSTERIA_VERSION)"
fi
[[ "$HYSTERIA_VERSION" == v* ]] || HYSTERIA_VERSION="v${HYSTERIA_VERSION}"

if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$(version_of "$INSTALL_PATH" || true)
  if [[ "$CURRENT" == "$HYSTERIA_VERSION" ]]; then
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

# ───── 3. Download the wanted release ─────
# Releases are tagged `app/vX.Y.Z` upstream, hence the escaped slash.
DOWNLOAD_URL="https://github.com/apernet/hysteria/releases/download/app%2F${HYSTERIA_VERSION}/hysteria-linux-${HY_ARCH}"
log "Downloading hysteria $HYSTERIA_VERSION from $DOWNLOAD_URL"

TMP=$(mktemp)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP" || fail "download failed: $DOWNLOAD_URL"
chmod +x "$TMP"

# ───── 4. Smoke-test ─────
# The binary has to say it is the version we asked for, or it does not get
# installed: a mirror or a redirect handing back something else is the failure
# this check exists for.
VERSION=$(version_of "$TMP" || true)
[[ "$VERSION" == "$HYSTERIA_VERSION" ]] \
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
