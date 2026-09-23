#!/usr/bin/env bash
# Install or move xray-core on an Ubuntu/Debian VPS, to the pinned release.
#
# The one road xray takes onto a node: install-iceslab-node.sh calls this for
# the xray and shadowsocks protocols (SS2022 runs inside xray-core), and the
# panel's "how to update" command calls it on a live node. The node-agent runs
# xray as its own child process, so xray.service is disabled at the end.
#
# Leaves the agent's identity alone: nothing under /etc/iceslab-node (mTLS
# keys, env) is read or written, and the agent's xray config is left in place.
#
# Idempotent, safe to rerun: a node already on the wanted version is left alone,
# a node on any other version is moved onto it.
#
# Env overrides:
#   XRAY_VERSION        release to install instead of the pin, e.g. 26.3.27, and
#   XRAY_SHA256         sha256 of its Xray-linux-<arch>.zip: both or neither, a
#                       version nobody checked has no checksum
#   XRAY_INSTALLER_REF  XTLS/Xray-install commit to run, and
#   XRAY_INSTALLER_SHA  sha256 of its install-release.sh: same rule, together
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

INSTALL_PATH=/usr/local/bin/xray

# ───── pinned version ─────
#
# Which xray, and the ceiling it must stay under, live in the version manifest
# (packages/shared/src/core-versions.ts) with their reasons; the block below is
# generated from it. From 26.9.8 on a node refuses every leg a sing-box chain
# dials into it (REALITY wants X25519MLKEM768, our dialler's uTLS offers none),
# which the manifest marks known-bad and its test refuses as a pin.
# >>> core-pins:xray >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
XRAY_PINNED_VERSION="26.3.27"
XRAY_PINNED_TAG="v26.3.27"
declare -A XRAY_PINNED_FILE=(
  [amd64]="Xray-linux-64.zip"
  [arm64]="Xray-linux-arm64-v8a.zip"
  [armv7]="Xray-linux-arm32-v7a.zip"
)
declare -A XRAY_PINNED_SHA256=(
  [amd64]="23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae"
  [arm64]="4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c"
  [armv7]="c7265ae13c63ca0241a037df4ef960ad37938c8a67d984cc08834b2cfdf5654b"
)
# <<< core-pins:xray <<<

# XTLS/Xray-install publishes no tags, only `main`, so it is pinned to a commit
# and checked against the sha256 of that commit's install-release.sh (computed
# 2026-09-23). A hostile push to main reaches no node.
XRAY_INSTALLER_PINNED_REF="e741a4f56d368afbb9e5be3361b40c4552d3710d"
XRAY_INSTALLER_PINNED_SHA="7f70c95f6b418da8b4f4883343d602964915e28748993870fd554383afdbe555"

pair_or_fail() {
  local a="$1" b="$2"
  if [[ -n "${!a:-}" && -z "${!b:-}" ]] || [[ -z "${!a:-}" && -n "${!b:-}" ]]; then
    fail "$a and $b go together: what nobody checked is not installed"
  fi
}
pair_or_fail XRAY_VERSION XRAY_SHA256
pair_or_fail XRAY_INSTALLER_REF XRAY_INSTALLER_SHA
XRAY_VERSION="${XRAY_VERSION:-$XRAY_PINNED_VERSION}"
XRAY_VERSION="${XRAY_VERSION#v}"
XRAY_INSTALLER_REF="${XRAY_INSTALLER_REF:-$XRAY_INSTALLER_PINNED_REF}"
XRAY_INSTALLER_SHA="${XRAY_INSTALLER_SHA:-$XRAY_INSTALLER_PINNED_SHA}"

# `xray version` starts "Xray 26.3.27 (Xray, Penetrates Everything.) ...". awk
# reads to the end so pipefail cannot kill the script on an early SIGPIPE.
version_of() {
  "$1" version 2>/dev/null | awk 'NR == 1 && $1 == "Xray" { v = $2 } END { print v }'
}

# xray.service belongs to upstream's installer; the agent runs xray itself, and
# a second xray on the same config would fight it for the ports.
disable_upstream_unit() {
  systemctl stop xray.service    >/dev/null 2>&1 || true
  systemctl disable xray.service >/dev/null 2>&1 || true
  log "xray.service disabled; iceslab-node manages xray directly"
}

# ───── 1. Already on the wanted version? ─────
if [[ -x "$INSTALL_PATH" ]]; then
  CURRENT=$(version_of "$INSTALL_PATH" || true)
  if [[ "$CURRENT" == "$XRAY_VERSION" ]]; then
    log "xray $CURRENT is already installed, which is the wanted version"
    disable_upstream_unit
    exit 0
  fi
  log "xray ${CURRENT:-unknown} is installed, moving it to $XRAY_VERSION"
fi

# ───── 2. Detect arch ─────
case "$(uname -m)" in
  x86_64|amd64)  XR_ARCH=amd64 ;;
  aarch64|arm64) XR_ARCH=arm64 ;;
  armv7l)        XR_ARCH=armv7 ;;
  *)             fail "Unsupported architecture: $(uname -m)" ;;
esac
WANT_SHA="${XRAY_SHA256:-${XRAY_PINNED_SHA256[$XR_ARCH]:-}}"
[[ -n "$WANT_SHA" ]] || fail "no pinned checksum for xray $XRAY_VERSION on $XR_ARCH"
ZIP_NAME="${XRAY_PINNED_FILE[$XR_ARCH]:-}"
[[ -n "$ZIP_NAME" ]] || fail "upstream ships no xray for $XR_ARCH"
TAG="${XRAY_PINNED_TAG//"$XRAY_PINNED_VERSION"/$XRAY_VERSION}"

TMP=$(mktemp -d)
AGENT_STOPPED=0
cleanup() {
  rm -rf "$TMP"
  # Whatever happened above, a node is not left without its agent.
  if [[ "$AGENT_STOPPED" == 1 ]]; then
    systemctl start iceslab-node >/dev/null 2>&1 || warn "could not start iceslab-node again, start it by hand"
  fi
}
trap cleanup EXIT

# ───── 3. Download and check the release and the installer ─────
# Release assets are handed out from another host, so redirects are followed,
# over https only; the sha256 is what makes the file trustworthy.
URL="https://github.com/XTLS/Xray-core/releases/download/${TAG}/${ZIP_NAME}"
log "Downloading $URL"
curl --proto '=https' --proto-redir '=https' -fsSL "$URL" -o "$TMP/xray.zip" || fail "download failed: $URL"
GOT_SHA=$(sha256sum "$TMP/xray.zip" | awk '{print $1}')
[[ "$GOT_SHA" == "$WANT_SHA" ]] || fail "checksum mismatch for $ZIP_NAME: got $GOT_SHA, expected $WANT_SHA"
log "Checksum OK ($GOT_SHA)"

INSTALLER_URL="https://raw.githubusercontent.com/XTLS/Xray-install/${XRAY_INSTALLER_REF}/install-release.sh"
curl --proto '=https' --max-redirs 0 -fsSL "$INSTALLER_URL" -o "$TMP/install-release.sh" \
  || fail "download failed: $INSTALLER_URL"
GOT_SHA=$(sha256sum "$TMP/install-release.sh" | awk '{print $1}')
[[ "$GOT_SHA" == "$XRAY_INSTALLER_SHA" ]] \
  || fail "checksum mismatch for install-release.sh at $XRAY_INSTALLER_REF: got $GOT_SHA, expected $XRAY_INSTALLER_SHA"

# ───── 4. Install through upstream's --local ─────
# On a live node the agent's xray is running, and install-release.sh reads any
# running xray as ITS service: it stops xray.service, and at the end starts it
# again, on the same config file the agent's xray holds the ports of. That start
# fails and the script exits 1. With the agent stopped for the few seconds of the
# install there is no running xray, and nothing is started behind our back; the
# trap above brings the agent back.
if systemctl is-active --quiet iceslab-node 2>/dev/null; then
  log "Stopping iceslab-node for the install (started again on exit)"
  systemctl stop iceslab-node
  AGENT_STOPPED=1
fi
# </dev/null: --local stops on `read -r` ("Press any key"); the script runs
# without `set -e`, so the read that meets end of input just returns.
#
# Its exit status is NOT the verdict: on an upgrade with no xray running, its
# last statement is `[[ "$XRAY_RUNNING" -eq '1' ]] && start_xray`, which is
# false, so a successful install exits 1 (install-release.sh:963-964 at the
# pinned commit). The smoke-test below asks the binary instead.
bash "$TMP/install-release.sh" install --local "$TMP/xray.zip" </dev/null \
  || log "install-release.sh exited $?; the installed binary decides below"
disable_upstream_unit

# ───── 5. Smoke-test ─────
VERSION=$(version_of "$INSTALL_PATH" || true)
[[ "$VERSION" == "$XRAY_VERSION" ]] || fail "installed xray reports '${VERSION:-nothing}', expected $XRAY_VERSION"
log "xray $VERSION is ready at $INSTALL_PATH"
