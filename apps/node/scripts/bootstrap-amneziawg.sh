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
#   --remove         take AmneziaWG off the node instead (refused while an
#                    interface is up)
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

# Whether the module is loaded, read from the file lsmod reads. Not
# `lsmod | grep -q`: under pipefail grep -q leaving early can kill lsmod with
# SIGPIPE and turn a loaded module into "not loaded" (E33, the same race in
# bootstrap-naive.sh).
amneziawg_loaded() { grep -q '^amneziawg ' /proc/modules 2>/dev/null; }

# What this script built last: "<tag> <srcversion>". The srcversion is what
# ties it to a module file, since both generations report version 1.0.0.
MARKER="${AWG_MODULE_MARKER:-/var/lib/iceslab-node/amneziawg-module}"

# The module this script built, as a fact the agent can check (Ф7.1): its
# version (the tag without the v, the manifest's form) and the srcversion of
# that build. The agent reports the version only while the loaded module has
# that srcversion; /sys/module says 1.0.0 for every generation.
wire_env() {
  local lines=(
    "AMNEZIAWG_BIN=$(command -v awg 2>/dev/null || echo /usr/bin/awg)"
    "AMNEZIAWG_QUICK_BIN=$(command -v awg-quick 2>/dev/null || echo /usr/bin/awg-quick)"
  )
  local tag="" src=""
  if [[ -f "$MARKER" ]]; then read -r tag src _ <"$MARKER" || true; fi
  if [[ -n "$tag" && -n "$src" ]]; then
    lines+=("AMNEZIAWG_MODULE_VERSION=${tag#v}" "AMNEZIAWG_MODULE_SRCVERSION=$src")
  fi
  node_env_block amneziawg "${lines[@]}"
}

unwire_env() {
  node_env_unblock amneziawg AMNEZIAWG_BIN AMNEZIAWG_QUICK_BIN AMNEZIAWG_INTERFACE \
    AMNEZIAWG_MODULE_VERSION AMNEZIAWG_MODULE_SRCVERSION
}

# --remove: the tools (awg, awg-quick, their unit template, man pages and
# completions), the kernel module from DKMS with its sources, the build trees,
# and the interface configs the agent rendered (the panel pushes them again,
# keys included, onto a node that gets AWG back). Kept: IP forwarding
# (99-awg.conf) and ufw's FORWARD policy, which other traffic on the node may
# rely on.
#
# Running = any AmneziaWG interface up, the users' awg0 and a cascade leg's
# awg-l<n> alike.
remove_core() {
  local up="" v
  up="$(ip -o link show type amneziawg 2>/dev/null | awk -F': ' '{print $2}' | tr '\n' ' ' || true)"
  if [[ -z "${up// /}" ]] && command -v awg >/dev/null 2>&1; then
    up="$(awg show interfaces 2>/dev/null || true)"
  fi
  up="${up% }"
  node_env_refuse_if_running amneziawg "${up:+interfaces up: $up}"
  rm -f "$(command -v awg-quick 2>/dev/null || echo /usr/bin/awg-quick)" "$(command -v awg 2>/dev/null || echo /usr/bin/awg)"
  rm -f /usr/lib/systemd/system/awg-quick@.service /lib/systemd/system/awg-quick@.service \
    /usr/share/man/man8/awg.8 /usr/share/man/man8/awg-quick.8 \
    /usr/share/bash-completion/completions/awg /usr/share/bash-completion/completions/awg-quick
  modprobe -r amneziawg 2>/dev/null || true
  if command -v dkms >/dev/null 2>&1; then
    for v in $(dkms status amneziawg 2>/dev/null | sed -n 's#^amneziawg/\([^,: ]*\).*#\1#p' | sort -u); do
      dkms remove "amneziawg/$v" --all >/dev/null 2>&1 || warn "dkms remove amneziawg/$v failed"
      rm -rf "/usr/src/amneziawg-$v"
    done
  fi
  rm -rf /usr/src/amneziawg-src /usr/src/amneziawg-tools-build
  rm -f "$MARKER"
  rm -f /etc/amnezia/amneziawg/*.conf
  systemctl daemon-reload >/dev/null 2>&1 || true
  unwire_env
  if amneziawg_loaded; then
    warn "the amneziawg module is still loaded (in use?); it goes with the next reboot"
  fi
  log "AmneziaWG removed"
}

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  remove_core
  node_env_done amneziawg
  exit 0
fi

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
# Ф7.1 (owner's decision 23.09, measured in Ф7.0 on se-02 26.09,
# docs/plan/f70-results.md): the 3.1 module and the 3.1 tools. The 3.1 module
# carries a 1.x interface and a 3.1 interface side by side, and the 1.x
# interface this node already serves keeps working as the agent renders it:
# every 1.x client of the fleet connected unchanged, with zero negative
# controls. So moving a node to this pin re-issues nothing; a 3.1 interface is
# a separate, later step.
#
# ⚠ The tag carries the AmneziaWG PROTOCOL generation (the v1 / v3 in front).
# Moving to another one is not a version bump: the test beside this file holds
# the generation to v3.1, and moving it is a decision about the operator's
# PEOPLE, taken with that test in the same commit.
#
# ⚠ Both module generations call themselves 1.0.0 (/sys/module, modinfo), so
# the version the agent reports comes from what THIS script installed, kept
# with the build's srcversion (MARKER below) and honoured by the agent only
# while the loaded module is that build.
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
AWG_MODULE_PINNED_VERSION="3.1.20260906"
AWG_MODULE_PINNED_TAG="v3.1.20260906"
AWG_MODULE_PINNED_COMMIT="4569c4c67f3a57414969260cafbbd04694fbaae0"
# <<< core-pins:amneziawg-module <<<
# >>> core-pins:amneziawg-tools >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
AWG_TOOLS_PINNED_VERSION="3.1.20260812"
AWG_TOOLS_PINNED_TAG="v3.1.20260812"
AWG_TOOLS_PINNED_COMMIT="ee0f0a9aa34ff0a0da4b3433b9512781cfe02843"
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

# MARKER (defined beside wire_env) holds what this script built last.
marker_tag()  { [[ -f "$MARKER" ]] && awk '{print $1}' "$MARKER" || true; }
marker_src()  { [[ -f "$MARKER" ]] && awk '{print $2}' "$MARKER" || true; }
loaded_src()  { cat /sys/module/amneziawg/srcversion 2>/dev/null || true; }

# Secure Boot refuses an unsigned module at load time, after a build that took
# minutes and looked fine (Ф7.0: our DKMS build is unsigned, "tainting
# kernel"). Asked BEFORE anything is built. mokutil where it exists; else the
# EFI variable itself, whose last byte is 1 when Secure Boot is on.
secure_boot_on() {
  local efi="${EFI_DIR:-/sys/firmware/efi}" state var
  [[ -d "$efi" ]] || return 1
  if command -v mokutil >/dev/null 2>&1; then
    state="$(mokutil --sb-state 2>/dev/null || true)"
    grep -qi 'SecureBoot enabled' <<<"$state" && return 0
    return 1
  fi
  for var in "$efi"/efivars/SecureBoot-*; do
    [[ -r "$var" ]] || continue
    [[ "$(od -An -tu1 -j4 -N1 "$var" 2>/dev/null | tr -d ' ')" == 1 ]] && return 0
  done
  return 1
}

# Whether an AmneziaWG interface is up: the module cannot be swapped under one.
awg_interfaces_up() {
  local up
  up="$(ip -o link show type amneziawg 2>/dev/null | awk -F': ' '{print $2}' || true)"
  [[ -n "${up//[[:space:]]/}" ]]
}

# Skip the build only when the loaded module is the one the marker says this
# script built, at the wanted tag.
if amneziawg_loaded && [[ "$(marker_tag)" == "$AWG_MODULE_TAG" && -n "$(loaded_src)" && "$(marker_src)" == "$(loaded_src)" ]]; then
  log "amneziawg module $AWG_MODULE_TAG already loaded (srcversion $(loaded_src)), skipping module install"
else
  if secure_boot_on; then
    fail "Secure Boot is on: the amneziawg module this script builds is unsigned and the kernel will refuse to load it. Turn Secure Boot off in the provider's console (or enroll a MOK key and sign DKMS modules), then run this again. Nothing was built."
  fi
  log "Installing amneziawg kernel module $AWG_MODULE_TAG via DKMS from $AWG_MODULE_REPO"

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

  # Remove stale DKMS entries (the other generation included: both name
  # themselves amneziawg/1.0.0) then add/build/install
  for old in $(dkms status amneziawg 2>/dev/null | sed -n 's#^amneziawg/\([^,: ]*\).*#\1#p' | sort -u); do
    dkms remove "amneziawg/$old" --all >/dev/null 2>&1 || true
  done
  dkms add "amneziawg/${AWG_VER}"
  dkms build "amneziawg/${AWG_VER}"
  dkms install --force "amneziawg/${AWG_VER}"

  BUILT_SRC="$(modinfo -F srcversion amneziawg 2>/dev/null || true)"
  [[ -n "$BUILT_SRC" ]] || fail "dkms installed amneziawg but modinfo cannot read its srcversion"
  mkdir -p "$(dirname "$MARKER")"
  printf '%s %s\n' "$AWG_MODULE_TAG" "$BUILT_SRC" >"$MARKER"
  log "built amneziawg $AWG_MODULE_TAG, srcversion $BUILT_SRC"

  if amneziawg_loaded && [[ "$(loaded_src)" != "$BUILT_SRC" ]]; then
    if awg_interfaces_up; then
      warn "an older amneziawg module is loaded and an interface is up: the new one takes over when the interfaces go down (or after a reboot)"
    else
      log "Replacing the loaded amneziawg module with the new build"
      modprobe -r amneziawg || warn "could not unload the old amneziawg module; the new one loads after a reboot"
    fi
  fi
  if ! amneziawg_loaded; then
    log "Loading amneziawg kernel module"
    modprobe amneziawg || warn "modprobe amneziawg failed, try rebooting"
  fi
fi

# ───── 4. AWG userspace tools ─────
AWG_TOOLS_REPO=https://github.com/amnezia-vpn/amneziawg-tools.git
AWG_TOOLS_DIR=/usr/src/amneziawg-tools-build

# The tools already there, if they are the wanted tag: `awg --version` says
# "amneziawg-tools v3.1.20260812 - ...". Anything else (the 1.x tools of a
# node from before Ф7.1, wireguard-tools under the name awg) is rebuilt.
TOOLS_NOW=""
if command -v awg >/dev/null && command -v awg-quick >/dev/null; then
  TOOLS_NOW="$(awg --version 2>&1 || true)"
fi
if [[ "$TOOLS_NOW" == "amneziawg-tools $AWG_TOOLS_TAG "* ]]; then
  log "awg tools already installed: ${TOOLS_NOW%%$'\n'*}"
else
  log "Building amneziawg-tools $AWG_TOOLS_TAG from $AWG_TOOLS_REPO"

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
if ! amneziawg_loaded; then
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
  # The tag this script built, and what the module calls itself: the two
  # differ (the v3.1.20260906 build says 3.1.20260812), and the tag is the one
  # the panel compares with the pin.
  echo "    Module: $(marker_tag) (srcversion $(loaded_src)); the module says $(cat /sys/module/amneziawg/version 2>/dev/null || echo unknown)"
else
  warn "Kernel module is NOT loaded. Try rebooting, then 'modprobe amneziawg'."
  warn "Or use amneziawg-go (userspace, ~30 Mbps): https://github.com/amnezia-vpn/amneziawg-go"
fi
