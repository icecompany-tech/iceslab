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
#
# Env overrides:
#   SINGBOX_VERSION  pin a release tag (default: latest stable)
#   SINGBOX_DEST     binary path     (default /usr/local/bin/sing-box)
#   SINGBOX_DIR      cert/config dir (default /etc/sing-box)
#   SINGBOX_SNI      cert CN / SNI   (default www.bing.com)
set -euo pipefail

SINGBOX_DEST="${SINGBOX_DEST:-/usr/local/bin/sing-box}"
SINGBOX_DIR="${SINGBOX_DIR:-/etc/sing-box}"
SINGBOX_SNI="${SINGBOX_SNI:-www.bing.com}"
SINGBOX_VERSION="${SINGBOX_VERSION:-}"

log()  { printf '[bootstrap-singbox] %s\n' "$*"; }
fail() { printf '[bootstrap-singbox] ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl    >/dev/null 2>&1 || fail "curl is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
command -v tar     >/dev/null 2>&1 || fail "tar is required"

# ───── host arch ─────
case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l)        ARCH=armv7 ;;
  *) fail "unsupported arch: $(uname -m)" ;;
esac

# ───── resolve version ─────
if [[ -z "$SINGBOX_VERSION" ]]; then
  log "resolving latest stable sing-box release"
  SINGBOX_VERSION="$(curl -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest \
    | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')"
  [[ -n "$SINGBOX_VERSION" ]] || fail "could not resolve latest version (set SINGBOX_VERSION)"
fi
VER="${SINGBOX_VERSION#v}"
log "installing sing-box v${VER} (${ARCH})"

# ───── download + install binary ─────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TARBALL="sing-box-${VER}-linux-${ARCH}.tar.gz"
URL="https://github.com/SagerNet/sing-box/releases/download/v${VER}/${TARBALL}"
log "downloading ${URL}"
curl -fsSL "$URL" -o "$TMP/sb.tar.gz" || fail "download failed: $URL"
tar -xzf "$TMP/sb.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name sing-box | head -n1)"
[[ -n "$BIN" ]] || fail "sing-box binary not found in tarball"
install -m 0755 "$BIN" "$SINGBOX_DEST"
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

log "done."
log "node-agent env: SINGBOX_BINARY=$SINGBOX_DEST SINGBOX_CERT=$SINGBOX_DIR/cert.pem SINGBOX_KEY=$SINGBOX_DIR/key.pem"
