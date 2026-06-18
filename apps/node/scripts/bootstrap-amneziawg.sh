#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS to run an AmneziaWG inbound.
#
# Installation strategy:
#   Ubuntu 22.04 (jammy) and earlier: use ppa:amnezia/amneziawg (Launchpad)
#   Ubuntu 24.04 (noble) and later:   PPA doesn't register for noble, so we
#     install via DKMS from the upstream GitHub source + build awg-tools.
#
# Idempotent, safe to rerun.
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

# ───── 1. Distro check ─────
[[ -r /etc/os-release ]] || fail "Cannot read /etc/os-release; unsupported distro"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported. Detected ID=${ID:-unknown}." ;;
esac
log "Detected $PRETTY_NAME"

# ───── 2. Prereqs ─────
log "Installing apt prereqs"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  software-properties-common gnupg ca-certificates curl \
  build-essential dkms git libmnl-dev pkg-config wireguard-tools

KERNEL_VER=$(uname -r)
log "Running kernel: $KERNEL_VER"
DEBIAN_FRONTEND=noninteractive apt-get install -y "linux-headers-${KERNEL_VER}" || \
  warn "linux-headers-${KERNEL_VER} not found, DKMS build may fail"

# ───── 3. Kernel module via DKMS ─────
AWG_MODULE_REPO=https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git
AWG_MODULE_DIR=/usr/src/amneziawg-src

if lsmod | grep -q '^amneziawg\b'; then
  log "amneziawg kernel module already loaded, skipping module install"
else
  log "Installing amneziawg kernel module via DKMS from $AWG_MODULE_REPO"

  # Fresh clone, no branch pin (repo default may be master)
  rm -rf "$AWG_MODULE_DIR"
  git clone --depth 1 "$AWG_MODULE_REPO" "$AWG_MODULE_DIR"

  # dkms.conf may be at root or one level deep
  DKMS_CONF=$(find "$AWG_MODULE_DIR" -maxdepth 2 -name 'dkms.conf' | head -1)
  if [[ -z "$DKMS_CONF" ]]; then
    fail "dkms.conf not found in $AWG_MODULE_DIR (repo structure may have changed)"
  fi
  log "Found dkms.conf at: $DKMS_CONF"

  # Parse version, fall back to a known good one
  AWG_VER=$(grep 'PACKAGE_VERSION' "$DKMS_CONF" | head -1 | grep -oP '"[^"]+"' | tr -d '"')
  if [[ -z "$AWG_VER" ]]; then
    AWG_VER="1.0.0"
    warn "Could not parse version from dkms.conf, using fallback $AWG_VER"
  fi
  log "amneziawg module version: $AWG_VER"

  # DKMS requires source in /usr/src/<name>-<version>/
  DKMS_SRC="/usr/src/amneziawg-${AWG_VER}"
  DKMS_ROOT=$(dirname "$DKMS_CONF")
  rm -rf "$DKMS_SRC"
  mkdir -p "$DKMS_SRC"
  cp -r "$DKMS_ROOT"/. "$DKMS_SRC/"

  # Remove stale DKMS entries then add/build/install
  dkms remove "amneziawg/${AWG_VER}" --all 2>/dev/null || true
  dkms add "amneziawg/${AWG_VER}"
  dkms build "amneziawg/${AWG_VER}"
  dkms install "amneziawg/${AWG_VER}"

  log "Loading amneziawg kernel module"
  modprobe amneziawg || warn "modprobe amneziawg failed, try rebooting"
fi

# ───── 4. AWG userspace tools ─────
AWG_TOOLS_REPO=https://github.com/amnezia-vpn/amneziawg-tools.git
AWG_TOOLS_DIR=/usr/src/amneziawg-tools-build

if command -v awg >/dev/null && command -v awg-quick >/dev/null; then
  log "awg tools already installed: $(awg --version 2>&1 | head -1)"
else
  log "Building amneziawg-tools from $AWG_TOOLS_REPO"

  rm -rf "$AWG_TOOLS_DIR"
  git clone --depth 1 "$AWG_TOOLS_REPO" "$AWG_TOOLS_DIR"

  make -C "$AWG_TOOLS_DIR/src" -j"$(nproc)"
  make -C "$AWG_TOOLS_DIR/src" install

  log "awg: $(awg --version 2>&1 | head -1)"
  log "awg-quick: $(command -v awg-quick)"
fi

# ───── 5. Verify ─────
command -v awg     >/dev/null || fail "awg binary not found after install"
command -v awg-quick >/dev/null || fail "awg-quick binary not found after install"

DKMS_OK=true
if ! lsmod | grep -q '^amneziawg\b'; then
  warn "amneziawg module not loaded, DKMS build may have failed or reboot needed"
  DKMS_OK=false
fi

# ───── 6. IP forwarding ─────
SYSCTL_CONF=/etc/sysctl.d/99-awg.conf
if [[ ! -f "$SYSCTL_CONF" ]]; then
  log "Enabling IP forwarding"
  echo "net.ipv4.ip_forward=1" > "$SYSCTL_CONF"
  echo "net.ipv6.conf.all.forwarding=1" >> "$SYSCTL_CONF"
  sysctl --system >/dev/null
fi

# ───── 7. Summary ─────
echo
if $DKMS_OK; then
  log "AmneziaWG kernel-mode is ready."
  echo "    Module: $(modinfo amneziawg 2>/dev/null | grep '^version' | head -1 || echo 'loaded')"
else
  warn "Kernel module is NOT loaded. Try rebooting, then 'modprobe amneziawg'."
  warn "Or use amneziawg-go (userspace, ~30 Mbps): https://github.com/amnezia-vpn/amneziawg-go"
fi
