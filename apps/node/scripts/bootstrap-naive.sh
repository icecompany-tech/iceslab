#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS to run a NaiveProxy inbound.
#
# NaiveProxy multi-user mode needs Caddy built with the klzgrad/forwardproxy@naive
# fork; the upstream `naive` standalone binary is single-tenant only. We use
# `xcaddy` to compile a Caddy with the naive plugin and drop the result at
# /usr/local/bin/caddy-naive.
#
# The node-agent spawns this Caddy itself, so there is no unit to write; the
# script ends by writing the naive block of the agent's env (lib/node-env.sh).
#
# Usage:  sudo bash bootstrap-naive.sh [--restart-agent] [--remove]
# Idempotent, safe to rerun (re-pulls upstream sources, re-builds binary).
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck source=lib/node-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-env.sh"
node_env_flags "$@" || fail "usage: $0 [--restart-agent]"

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

CADDY_NAIVE_BIN=${CADDY_NAIVE_BIN:-/usr/local/bin/caddy-naive}

# The agent finds caddy-naive at its default path on its own; the block says
# where it is anyway, so a CADDY_NAIVE_BIN override reaches the agent too.
# (The installer used to write NAIVE_BINARY, which the agent never read.)
wire_env() {
  node_env_block naive \
    "CADDY_NAIVE_BIN=$CADDY_NAIVE_BIN" \
    "NAIVE_CONFIG=$(node_env_keep NAIVE_CONFIG /etc/caddy/Caddyfile)"
}

unwire_env() {
  node_env_unblock naive CADDY_NAIVE_BIN NAIVE_CONFIG NAIVE_BINARY NAIVE_PORT
}

# --remove: the built Caddy and the Caddyfile the agent rendered. Kept: Go and
# xcaddy (build tools other things may use), Caddy's data directory with its
# ACME certificates, /etc/caddy itself.
remove_core() {
  local config
  config="$(node_env_keep NAIVE_CONFIG /etc/caddy/Caddyfile)"
  node_env_refuse_if_running caddy-naive "$(node_env_pids caddy-naive)"
  rm -f "$CADDY_NAIVE_BIN" "$config"
  unwire_env
  log "caddy-naive removed"
}

if [[ "$NODE_ENV_REMOVE" == 1 ]]; then
  remove_core
  node_env_done naive
  exit 0
fi
GO_VERSION=${GO_VERSION:-1.23.4}

# ───── 1. Distro check ─────
if [[ ! -r /etc/os-release ]]; then
  fail "Cannot read /etc/os-release; unsupported distro"
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian are supported here. Detected ID=${ID:-unknown}." ;;
esac
log "Detected $PRETTY_NAME"

# ───── 2. Prereqs ─────
log "Installing apt prereqs (curl, ca-certificates, git)"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates git build-essential

# ───── 3. Go toolchain ─────
# Ubuntu's apt go can lag the Caddy/xcaddy minimum, so install the upstream
# tarball in /usr/local/go regardless of what apt has.
NEED_GO=true
if command -v go >/dev/null; then
  CUR=$(go version | awk '{print $3}' | sed 's/^go//')
  if [[ "$(printf '%s\n' "1.22" "$CUR" | sort -V | head -1)" == "1.22" ]]; then
    log "Go $CUR already meets >= 1.22"
    NEED_GO=false
  fi
fi
if $NEED_GO; then
  log "Installing Go $GO_VERSION to /usr/local/go"
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in
    amd64) GO_ARCH=amd64 ;;
    arm64) GO_ARCH=arm64 ;;
    *) fail "Unsupported arch: $ARCH" ;;
  esac
  TARBALL="go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
  TMPDL=$(mktemp -d)
  curl -fsSL "https://go.dev/dl/${TARBALL}" -o "${TMPDL}/${TARBALL}"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "${TMPDL}/${TARBALL}"
  rm -rf "$TMPDL"
fi
export PATH=/usr/local/go/bin:$PATH

# ───── 4. xcaddy ─────
if ! command -v xcaddy >/dev/null; then
  log "Installing xcaddy"
  GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
fi
log "xcaddy: $(xcaddy version 2>&1 | head -1 || echo present)"

# ───── 5. Build caddy + forwardproxy@naive ─────
#
# The replacement target on the LEFT MUST be
# `github.com/caddyserver/forwardproxy@caddy2` (the module path Caddy v2
# expects), not plain `github.com/caddyserver/forwardproxy`. Without the
# @caddy2 suffix xcaddy still produces a binary, but the forward_proxy
# handler never registers: `caddy list-modules` shows nothing under
# http.handlers.forward_proxy and runtime fails silently. Caught in prod
# on a second xcaddy build, when the module cache resolved a different
# inner version than the first attempt and exposed the missing suffix.
#
# We reference the `@naive` BRANCH (not a v2.x tag) because klzgrad's repo
# doesn't follow the Go-modules /v2 path convention: Go semver rejects
# tags >= v2.0 unless the module path ends in /v2. A branch reference
# resolves to a pseudo-version that bypasses semver strict mode, which is
# what the NaiveProxy ArchWiki and klzgrad/forwardproxy README document.
log "Building Caddy + klzgrad/forwardproxy@naive plugin -> $CADDY_NAIVE_BIN"

# Clear stale module cache from prior failed builds; otherwise `go build`
# can keep resolving to a half-baked older entry.
rm -rf "${GOPATH:-$HOME/go}/pkg/mod/cache/download/github.com/klzgrad" 2>/dev/null || true

WORKDIR=$(mktemp -d)
pushd "$WORKDIR" > /dev/null
xcaddy build \
  --with 'github.com/caddyserver/forwardproxy@caddy2=github.com/klzgrad/forwardproxy@naive' \
  --output "$CADDY_NAIVE_BIN"
popd > /dev/null
rm -rf "$WORKDIR"
chmod +x "$CADDY_NAIVE_BIN"

# ───── 6. Verify ─────
if ! "$CADDY_NAIVE_BIN" version >/dev/null; then
  fail "$CADDY_NAIVE_BIN is not executable; build failed."
fi
log "$CADDY_NAIVE_BIN $(${CADDY_NAIVE_BIN} version | head -1)"

# Confirm the naive plugin got linked in.
if ! "$CADDY_NAIVE_BIN" list-modules 2>/dev/null | grep -q '^http\.handlers\.forward_proxy$'; then
  warn "forward_proxy module not present in built Caddy; build was misconfigured."
  exit 1
fi
log "✓ forward_proxy module is linked"

# ───── 7. Agent env ─────
mkdir -p /etc/caddy
wire_env
node_env_done naive

# ───── 8. Summary ─────
echo
log "✓ Caddy + NaiveProxy fork is ready."
echo
echo "Next steps:"
echo "  - Point the DNS A-record at this VPS so Caddy can auto-fetch LE certs"
echo "    via tls-alpn-01 / http-01."
echo
warn "NaiveProxy bumps Chromium roughly every 30 days. Re-run this script"
warn "periodically; a stale TLS fingerprint is easier to fingerprint."
