#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS to run an AmneziaWG inbound.
#
# Installation strategy:
#   Ubuntu 22.04 (jammy) and earlier: use ppa:amnezia/amneziawg (Launchpad)
#   Ubuntu 24.04 (noble) and later:   PPA doesn't register for noble, so we
#     install via DKMS from the upstream GitHub source + build awg-tools.
#
# Ends by writing the amneziawg block of the agent's env (lib/node-env.sh).
# The agent looks for awg at /usr/bin/awg unless told otherwise, and `make
# install` may put it elsewhere; the block names where it actually is. The
# agent brings interfaces up with awg-quick itself, so there is no unit here.
#
# Idempotent, safe to rerun.
#
# Flags:
#   --restart-agent  restart iceslab-node at the end
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

wire_env() {
  node_env_block amneziawg \
    "AMNEZIAWG_BIN=$(command -v awg 2>/dev/null || echo /usr/bin/awg)" \
    "AMNEZIAWG_QUICK_BIN=$(command -v awg-quick 2>/dev/null || echo /usr/bin/awg-quick)"
}

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

# ───── Pinned upstream refs ─────
#
# Both of these used to be `git clone --depth 1` of the default branch, so the
# module a node got was whatever upstream had pushed that morning. Two nodes
# installed a fortnight apart ran different kernel modules, and the panel had
# no way to know: the fleet drifted silently and only DPI would ever have said
# so.
#
# The refs below are WHAT THE FLEET RUNS, read off the stand on 2026-09-21
# (docs/qa/field-test/00-stand.md): ru-01 and se-01 carry module
# 1.0.20260611 and amneziawg-tools v1.0.20260618-2.
#
# The first pin (8444c70) froze `master` instead, which was v3.1 by then, so a
# node installed after it would have joined the fleet on the OTHER protocol
# generation. That is not a version skew, it is a different protocol: see the
# warning below. Corrected here to match the machines that exist.
#
# ⚠ The tag carries the AmneziaWG PROTOCOL generation (the v1 / v3 in front).
# Changing it is not a version bump, it is a re-issue of every config already
# handed to a person, and every client older than 4.8.12.9 stops connecting. It
# is a decision about the operator's PEOPLE, taken elsewhere and never as a side
# effect of updating this script. Keep the generation, move the date. The test
# beside this file refuses anything that does not start with `v1.` for exactly
# that reason.
#
# ⚠ The tools tag ends in `-2` and that is part of the TAG, not a packaging
# suffix: upstream has both v1.0.20260618 and v1.0.20260618-2, at different
# commits. Verified against the GitHub API before this was written.
#
# The SHA is checked after the clone because a tag can be moved and a commit
# cannot. If upstream ever re-tags, the install fails loudly instead of
# installing something else under a familiar name.
#
# Tags and commits come from the version manifest
# (packages/shared/src/core-versions.ts), in the blocks below; the manifest also
# marks every other generation known-bad, so a pin cannot cross it by accident.
# >>> core-pins:amneziawg-module >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
AWG_MODULE_PINNED_VERSION="1.0.20260611"
AWG_MODULE_PINNED_TAG="v1.0.20260611"
AWG_MODULE_PINNED_COMMIT="2a6e1a02ac024f54a23e18f894a279b7f870b8fb"
# <<< core-pins:amneziawg-module <<<
# >>> core-pins:amneziawg-tools >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
AWG_TOOLS_PINNED_VERSION="1.0.20260618-2"
AWG_TOOLS_PINNED_TAG="v1.0.20260618-2"
AWG_TOOLS_PINNED_COMMIT="61e741780e8465a67a7d7fb6cffe14a8a15d624a"
# <<< core-pins:amneziawg-tools <<<
AWG_MODULE_TAG="${AWG_MODULE_TAG:-$AWG_MODULE_PINNED_TAG}"
AWG_MODULE_SHA="${AWG_MODULE_SHA:-$AWG_MODULE_PINNED_COMMIT}"
AWG_TOOLS_TAG="${AWG_TOOLS_TAG:-$AWG_TOOLS_PINNED_TAG}"
AWG_TOOLS_SHA="${AWG_TOOLS_SHA:-$AWG_TOOLS_PINNED_COMMIT}"

# Clone one ref and refuse anything but the commit we asked for.
clone_pinned() {
  local repo="$1" dir="$2" tag="$3" sha="$4"
  rm -rf "$dir"
  git clone --depth 1 --branch "$tag" "$repo" "$dir" \
    || fail "could not clone $repo at $tag"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  if [[ "$got" != "$sha" ]]; then
    fail "$repo $tag is $got, expected $sha. The tag moved upstream; check what changed before updating the pin."
  fi
  log "$repo pinned at $tag ($sha)"
}

# ───── 3. Kernel module via DKMS ─────
AWG_MODULE_REPO=https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git
AWG_MODULE_DIR=/usr/src/amneziawg-src

if lsmod | grep -q '^amneziawg\b'; then
  log "amneziawg kernel module already loaded, skipping module install"
else
  log "Installing amneziawg kernel module via DKMS from $AWG_MODULE_REPO"

  clone_pinned "$AWG_MODULE_REPO" "$AWG_MODULE_DIR" "$AWG_MODULE_TAG" "$AWG_MODULE_SHA"

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

  clone_pinned "$AWG_TOOLS_REPO" "$AWG_TOOLS_DIR" "$AWG_TOOLS_TAG" "$AWG_TOOLS_SHA"

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

# ───── 7. Agent env ─────
wire_env
node_env_done amneziawg

# ───── 8. Summary ─────
echo
if $DKMS_OK; then
  log "AmneziaWG kernel-mode is ready."
  echo "    Module: $(modinfo amneziawg 2>/dev/null | grep '^version' | head -1 || echo 'loaded')"
else
  warn "Kernel module is NOT loaded. Try rebooting, then 'modprobe amneziawg'."
  warn "Or use amneziawg-go (userspace, ~30 Mbps): https://github.com/amnezia-vpn/amneziawg-go"
fi
