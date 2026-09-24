#!/usr/bin/env bash
# bootstrap-singbox.sh
#
# Installs the sing-box engine and a self-signed TLS certificate for the TUIC
# inbound. Wired into install-iceslab-node.sh when --protocol tuic (singbox-S1).
#
#   - downloads the sing-box release binary for the host arch into
#     /usr/local/bin/sing-box
#   - generates a self-signed cert+key at /etc/sing-box/{cert.pem,key.pem}.
#     TUIC mandates TLS; for the alpha the client connects with allow_insecure
#     plus a matching SNI. A real Let's Encrypt cert on the node domain is a
#     later slice (shared with the hysteria/naive ACME work).
#   - writes the sing-box block of the agent's env (lib/node-env.sh): the agent
#     registers its sing-box adapters, and runs a cascade chain, only when
#     SINGBOX_BINARY is set. E20: this used to be printed, not written.
#
# Flags:
#   --restart-agent  restart iceslab-node at the end
#   --remove         take sing-box off the node instead (refused while it runs)
#
# Env overrides:
#   SINGBOX_VERSION  release to install instead of the pin, e.g. 1.13.14, and
#   SINGBOX_SHA256   sha256 of its sing-box-<version>-linux-<arch>.tar.gz: both
#                    or neither, a version nobody checked has no checksum
#   SINGBOX_DEST     binary path     (default /usr/local/bin/sing-box)
#   SINGBOX_DIR      cert/config dir (default /etc/sing-box)
#   SINGBOX_SNI      cert CN / SNI   (default www.bing.com)
set -euo pipefail

SINGBOX_DEST="${SINGBOX_DEST:-/usr/local/bin/sing-box}"
SINGBOX_DIR="${SINGBOX_DIR:-/etc/sing-box}"
SINGBOX_SNI="${SINGBOX_SNI:-www.bing.com}"
# ───── pinned version ─────
#
# The version a node gets is a decision, not whatever GitHub answered the
# minute somebody ran the installer. Every config this panel renders is
# rendered FOR a version: a fleet installed across two weeks used to end up on
# two different engines, and the same rendered config was then correct on one
# node and wrong on the next, with nothing anywhere saying so.
#
# Why this release is the pin is written beside it in the version manifest
# (packages/shared/src/core-versions.ts); the block below is generated from it.
# Moving it is a change there, with a test run behind it.
#
# `latest` is gone: the tarball is now checked against a sha256, and a release
# resolved on the day has none to check against.
# >>> core-pins:singbox >>>
# Generated from packages/shared/src/core-versions.ts, do not edit by hand:
# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.
SINGBOX_PINNED_VERSION="1.13.14"
SINGBOX_PINNED_TAG="v1.13.14"
declare -A SINGBOX_PINNED_FILE=(
  [amd64]="sing-box-1.13.14-linux-amd64.tar.gz"
  [arm64]="sing-box-1.13.14-linux-arm64.tar.gz"
  [armv7]="sing-box-1.13.14-linux-armv7.tar.gz"
)
declare -A SINGBOX_PINNED_SHA256=(
  [amd64]="f48703461a15476951ac4967cdad339d986f4b8096b4eb3ff0829a500502d697"
  [arm64]="4742df6a4314e8ecc41736849fca6d73b8f9e91b6e8b06ee794ff17ba180579e"
  [armv7]="e01a58d28512b1447ab6156017afdeeaa306169a95d27abc00e112599e4ae46c"
)
# <<< core-pins:singbox <<<

log()  { printf '[bootstrap-singbox] %s\n' "$*"; }
fail() { printf '[bootstrap-singbox] ERROR: %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

wire_env() {
  node_env_block singbox \
    "SINGBOX_BINARY=$SINGBOX_DEST" \
    "SINGBOX_CERT=$SINGBOX_DIR/cert.pem" \
    "SINGBOX_KEY=$SINGBOX_DIR/key.pem"
}

unwire_env() {
  node_env_unblock singbox SINGBOX_BINARY SINGBOX_CERT SINGBOX_KEY SINGBOX_STATS_BIN
}

# The agent's unit runs under ProtectSystem=strict and writes only where
# ReadWritePaths says. /etc/sing-box, where every sing-box adapter writes its
# config, was missing from that list until ba82fd8, and a node installed before
# it never gets the new unit (reinstalling wipes the mTLS keys). So the
# bootstrap that puts sing-box on a node adds the directory itself, as a
# drop-in, when the unit lacks it. Picked up at the agent's next restart.
agent_may_write_configs() {
  local dropin=/etc/systemd/system/iceslab-node.service.d/sing-box.conf
  systemctl cat iceslab-node.service >/dev/null 2>&1 || return 0
  if systemctl cat iceslab-node.service 2>/dev/null | grep -Eq '^ReadWritePaths=.*-?/etc/sing-box( |$)'; then
    return 0
  fi
  mkdir -p "$(dirname "$dropin")"
  printf '[Service]\nReadWritePaths=-%s\n' "$SINGBOX_DIR" >"$dropin"
  systemctl daemon-reload
  log "the agent's unit could not write $SINGBOX_DIR: added $dropin"
}

# --remove: the binary and the configs the agent rendered for its sing-box
# adapters. Kept: the self-signed cert and key, so a reinstall serves the same
# certificate its TUIC/AnyTLS clients already accept; the chain's own config,
# which lives with the agent (/etc/iceslab-node/chain).
remove_core() {
  node_env_refuse_if_running sing-box "$(node_env_pids sing-box)"
  rm -f "$SINGBOX_DEST"
  rm -f "$SINGBOX_DIR"/config.json "$SINGBOX_DIR"/anytls.json "$SINGBOX_DIR"/shadowtls.json \
    "$SINGBOX_DIR"/xray.json "$SINGBOX_DIR"/hy2.json "$SINGBOX_DIR"/ss.json
  unwire_env
  log "sing-box removed (kept $SINGBOX_DIR/cert.pem and key.pem)"
}

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  [[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"
  remove_core
  node_env_done singbox
  exit 0
fi

if [[ -n "${SINGBOX_VERSION:-}" && -z "${SINGBOX_SHA256:-}" ]] || [[ -z "${SINGBOX_VERSION:-}" && -n "${SINGBOX_SHA256:-}" ]]; then
  fail "SINGBOX_VERSION and SINGBOX_SHA256 go together: a version without its checksum is not installed"
fi
SINGBOX_VERSION="${SINGBOX_VERSION:-$SINGBOX_PINNED_VERSION}"
SINGBOX_VERSION="${SINGBOX_VERSION#v}"

command -v curl    >/dev/null 2>&1 || fail "curl is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
command -v tar     >/dev/null 2>&1 || fail "tar is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

# ───── host arch ─────
case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l)        ARCH=armv7 ;;
  *) fail "unsupported arch: $(uname -m)" ;;
esac

WANT_SHA="${SINGBOX_SHA256:-${SINGBOX_PINNED_SHA256[$ARCH]:-}}"
[[ -n "$WANT_SHA" ]] || fail "no pinned checksum for sing-box $SINGBOX_VERSION on $ARCH"
# The pinned file for this arch, with the version swapped in for an override.
TARBALL="${SINGBOX_PINNED_FILE[$ARCH]:-}"
[[ -n "$TARBALL" ]] || fail "upstream ships no sing-box for $ARCH"
TARBALL="${TARBALL//"$SINGBOX_PINNED_VERSION"/$SINGBOX_VERSION}"
TAG="${SINGBOX_PINNED_TAG//"$SINGBOX_PINNED_VERSION"/$SINGBOX_VERSION}"
log "installing sing-box ${SINGBOX_VERSION} (${ARCH})"

# ───── download, check, install binary ─────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/SagerNet/sing-box/releases/download/${TAG}/${TARBALL}"
log "downloading ${URL}"
curl -fsSL "$URL" -o "$TMP/sb.tar.gz" || fail "download failed: $URL"
GOT_SHA=$(sha256sum "$TMP/sb.tar.gz" | awk '{print $1}')
[[ "$GOT_SHA" == "$WANT_SHA" ]] || fail "checksum mismatch for $TARBALL: got $GOT_SHA, expected $WANT_SHA"
log "checksum OK ($GOT_SHA)"
tar -xzf "$TMP/sb.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name sing-box | head -n1)"
[[ -n "$BIN" ]] || fail "sing-box binary not found in tarball"
install -m 0755 -o root -g root "$BIN" "$SINGBOX_DEST"
log "installed binary -> $SINGBOX_DEST"

# ───── self-signed TLS cert (TUIC requires TLS) ─────
mkdir -p "$SINGBOX_DIR"
if [[ -f "$SINGBOX_DIR/cert.pem" && -f "$SINGBOX_DIR/key.pem" ]]; then
  log "TLS cert already present, keeping it"
else
  log "generating self-signed cert CN=${SINGBOX_SNI} (10y, EC P-256)"
  openssl ecparam -genkey -name prime256v1 -out "$SINGBOX_DIR/key.pem"
  openssl req -new -x509 -days 3650 -key "$SINGBOX_DIR/key.pem" \
    -out "$SINGBOX_DIR/cert.pem" -subj "/CN=${SINGBOX_SNI}" \
    -addext "subjectAltName=DNS:${SINGBOX_SNI}"
  chmod 600 "$SINGBOX_DIR/key.pem"
  chmod 644 "$SINGBOX_DIR/cert.pem"
fi

agent_may_write_configs
wire_env
node_env_done singbox
log "done."
