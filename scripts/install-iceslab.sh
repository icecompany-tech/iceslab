#!/usr/bin/env bash
# Iceslab one-command installer.
#
# What it does:
#   1. Verifies Docker + Compose plugin (installs them on Ubuntu/Debian if missing)
#   2. Clones this repo into $ICESLAB_DIR (default /opt/iceslab)
#   3. Generates `.env.production` with random JWT_SECRET + Postgres password
#   4. Builds the panel-backend / panel-frontend images locally
#   5. Runs Prisma migrate deploy (one-shot service)
#   6. Brings up the full stack and waits for health
#
# Idempotent, safe to rerun. Won't overwrite an existing .env.production.
#
# Usage (as root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab.sh)
#
# Or with a specific tag/branch:
#   ICESLAB_REF=v0.1.8 bash <(curl ...)
#
# Customisation via env:
#   ICESLAB_DIR        Install dir (default /opt/iceslab)
#   ICESLAB_REPO       Git URL (default https://github.com/icecompany-tech/iceslab.git)
#   ICESLAB_REF        Branch/tag/sha (default v0.1.8, pinned for alpha)
#   ICESLAB_REF_SHA    Optional commit SHA to verify after checkout. Defeats
#                      upstream tag re-pointing. Recommended for prod.
#   FRONTEND_PORT        Host port the SPA listens on (default 8080)
#   CORS_ORIGIN          Allowed origin for the API (default http://<vps-ip>:<FRONTEND_PORT>)
#   PANEL_DOMAIN         If set (e.g. panel.example.com), install + configure Caddy
#                        with auto-TLS. CORS_ORIGIN is auto-set to https://$PANEL_DOMAIN.
#                        DNS A record for the domain MUST already point at this VPS,
#                        otherwise Let's Encrypt HTTP-01 challenge will fail.

set -euo pipefail

log()  { printf '\033[1;34m[iceslab]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }

# Captured once at start so step() and the final summary can report total
# install duration, and the operator can tell "stuck" from "slow".
INSTALL_START_TS=$(date +%s)
LAST_STEP_TS=$INSTALL_START_TS
LAST_STEP_LABEL="(pre-flight)"

fmt_duration() {
  # Format seconds as Xm SSs (e.g. "3m07s"), or SSs if under 60.
  local total=$1
  local m=$((total / 60))
  local s=$((total % 60))
  if [[ "$m" -gt 0 ]]; then
    printf '%dm%02ds' "$m" "$s"
  else
    printf '%ds' "$s"
  fi
}

elapsed_total() {
  fmt_duration "$(( $(date +%s) - INSTALL_START_TS ))"
}

elapsed_step() {
  fmt_duration "$(( $(date +%s) - LAST_STEP_TS ))"
}

STEP_N=0
# 1 Prereqs, 2 Firewall, 3 Docker, 4 Source, 5 Config, 6 Pre-pull, 7 Build,
# 8 Migrate, 9 Launch. +1 Caddy if PANEL_DOMAIN set (set further below).
STEP_TOTAL=9
step() {
  # Print the previous step's duration before moving on (skipped on the first
  # step, where LAST_STEP_LABEL is still the placeholder).
  if [[ "$STEP_N" -gt 0 ]]; then
    printf '\033[2m       step %d done in %s\033[0m\n' "$STEP_N" "$(elapsed_step)"
  fi
  STEP_N=$((STEP_N + 1))
  LAST_STEP_TS=$(date +%s)
  LAST_STEP_LABEL="$*"
  printf '\n\033[1;36m[%d/%d]\033[0m \033[1m%s\033[0m  \033[2m(+%s total)\033[0m\n' \
    "$STEP_N" "$STEP_TOTAL" "$*" "$(elapsed_total)"
}

# ERR trap: fires when any unguarded command exits non-zero under `set -e`.
# Prints the failing line, the command, the step we were on, and a tail of
# the install log if the operator was teeing into one. Beats the bare `set -e`
# exit that leaves you staring at a half-finished terminal.
on_error() {
  local exit_code=$?
  local line_no=$1
  local cmd=$2
  printf '\n\033[1;31m✗ install-iceslab.sh failed\033[0m\n' >&2
  printf '  Step:    [%d/%d] %s\n' "$STEP_N" "$STEP_TOTAL" "$LAST_STEP_LABEL" >&2
  printf '  Where:   %s line %d\n' "${BASH_SOURCE[0]:-script}" "$line_no" >&2
  printf '  Command: %s\n' "$cmd" >&2
  printf '  Exit:    %d\n' "$exit_code" >&2
  printf '  Step time:  %s\n' "$(elapsed_step)" >&2
  printf '  Total time: %s\n' "$(elapsed_total)" >&2
  printf '\n' >&2
  # If the operator used the recommended `tee /tmp/install-panel.log`, show
  # the tail so they don't have to scroll terminal history. Filter out our
  # own error-block lines, otherwise tee (which also captures stderr into the
  # same file we're reading) makes the tail echo this very message back.
  if [[ -r /tmp/install-panel.log ]]; then
    printf '  Last 30 log lines (/tmp/install-panel.log):\n' >&2
    # Strip lines that belong to a prior error-block (this very block, since
    # `tee` captures stderr into the log we're reading). Match all known
    # error-block patterns: the header, all field lines, the tail header,
    # the trailing instructions, and the indented body lines (4 spaces).
    tail -80 /tmp/install-panel.log \
      | grep -v -E '^(\s*)?(✗ install-iceslab|  (Step|Where|Command|Exit|Step time|Total time):|  Last [0-9]+ log lines|  Re-run is idempotent|  install command again|    )' \
      | tail -30 \
      | sed "s/^/    /" >&2
    printf '\n' >&2
  fi
  printf '  Re-run is idempotent: fix the cause above, then run the same\n' >&2
  printf '  install command again. State from previous attempts is reused.\n' >&2
  exit "$exit_code"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

banner() {
  printf '\n'
  printf '\033[1;36m  ___ ___ ___ ___  _      _   ___\n'
  printf ' |_ _/ __| __/ __|| |    /_\\ | _ )\n'
  printf '  | | (__| _|\\__ \\| |__ / _ \\| _ \\\n'
  printf ' |___\\___|___|___/|____/_/ \\_\\___/\033[0m\n'
  printf '\n'
  printf '  Self-hosted multi-core proxy panel\n'
  printf '  v0.1.8  ·  github.com/icecompany-tech/iceslab\n'
  printf '\n'
}

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash $0)"

banner

# ───── Concurrency + apt lock hygiene ─────
# Caught live 2026-05-13: operator ran the installer twice (impatient retry
# after the curl looked like it hung), the 2nd run crashed on an `apt-get`
# lock held by the 1st. Three layered protections:
#
# 1. flock(1) on /var/run/iceslab-install.lock: refuses a second concurrent
#    install-iceslab.sh on the same host.
# 2. APT_OPTS sets DPkg::Lock::Timeout=300, so apt waits up to 5 min for the
#    lock instead of failing instantly. Covers the boot-time case where
#    Ubuntu's `unattended-upgrades` is running.
# 3. Stale-lock cleanup: if a previous apt-get died and left the lock file
#    behind with no process holding it, remove it and run
#    `dpkg --configure -a` to finish any half-applied state.
exec 9>/var/run/iceslab-install.lock || fail "cannot open install lockfile"
if ! flock -n 9; then
  fail "another install-iceslab.sh is already running (lock held). Wait for it, or 'rm /var/run/iceslab-install.lock' if you're sure it crashed."
fi

APT_OPTS=(-o "DPkg::Lock::Timeout=300" -o "Dpkg::Options::=--force-confold" -o "Dpkg::Options::=--force-confdef")
APT_ENV=(env DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none)

cleanup_stale_apt_locks() {
  local lock_holder
  # A lock file that exists but has no process holding it (fuser empty) is stale.
  for lockfile in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock; do
    [[ -e "$lockfile" ]] || continue
    lock_holder=$(fuser "$lockfile" 2>/dev/null || true)
    if [[ -z "$lock_holder" ]]; then
      log "stale apt lock detected at $lockfile (no process holds it), removing"
      rm -f "$lockfile"
    fi
  done
  # Finish any packages an interrupted apt left half-configured. No-op when clean.
  dpkg --configure -a >/dev/null 2>&1 || true
}
cleanup_stale_apt_locks

ICESLAB_DIR=${ICESLAB_DIR:-/opt/iceslab}
ICESLAB_REPO=${ICESLAB_REPO:-https://github.com/icecompany-tech/iceslab.git}
ICESLAB_REF=${ICESLAB_REF:-v0.1.8}
FRONTEND_PORT=${FRONTEND_PORT:-8080}
PANEL_DOMAIN=${PANEL_DOMAIN:-}
ACME_DEFAULT_EMAIL=${ACME_DEFAULT_EMAIL:-}

# ───── Interactive domain prompt ─────
# If PANEL_DOMAIN wasn't passed via env AND we have a real TTY (admin running
# this hands-on, not from cron / cloud-init), ask. The `bash <(curl ...)` flow
# eats stdin with the curl pipe, so we read from /dev/tty directly: that's the
# actual terminal regardless of how stdin is wired.
if [[ -z "$PANEL_DOMAIN" && -r /dev/tty ]]; then
  printf '\n'
  printf '\033[1;36m═══════════════════════════════════════════════════════\033[0m\n'
  printf '\033[1;36m  Iceslab installer\033[0m\n'
  printf '\033[1;36m═══════════════════════════════════════════════════════\033[0m\n'
  printf '\n'
  printf 'На каком домене разместить панель?\n'
  printf '  Пример:    panel.example.com\n'
  printf '  Требование: A-запись домена ДОЛЖНА уже указывать на этот VPS\n'
  printf '              (иначе Let'\''s Encrypt не выпустит TLS-сертификат)\n'
  printf '\n'
  printf 'Оставь пустым и нажми Enter: установим без TLS, доступ по IP:%s\n' "$FRONTEND_PORT"
  printf '\n'
  printf '\033[1;33mДомен:\033[0m '
  read -r PANEL_DOMAIN </dev/tty || PANEL_DOMAIN=""

  if [[ -n "$PANEL_DOMAIN" ]]; then
    # Strip protocol if admin pasted full URL by accident.
    PANEL_DOMAIN="${PANEL_DOMAIN#http://}"
    PANEL_DOMAIN="${PANEL_DOMAIN#https://}"
    PANEL_DOMAIN="${PANEL_DOMAIN%/}"
    STEP_TOTAL=11

    # Quick sanity-check on the value before we commit to it. Catches
    # the typo case where the admin types a single word without a dot.
    if [[ ! "$PANEL_DOMAIN" =~ \. ]]; then
      printf '\033[1;31m"%s" не похож на домен (нет точки). Установка прервана.\033[0m\n' "$PANEL_DOMAIN" >&2
      exit 1
    fi

    log "Будет установлено на https://${PANEL_DOMAIN} (Caddy + auto-TLS)"
  else
    log "Домен не указан: установка в bare-IP режиме (доступ по http://<ip>:${FRONTEND_PORT})"
  fi
  printf '\n'
fi

# ───── Interactive ACME email prompt ─────
# Caught live 2026-05-12: with this empty, the panel's install-node emitter
# fell back to `--hysteria-email admin@example.com`, which Let's Encrypt
# rejects as a forbidden test domain. The operator only finds out 15 min later
# when the fresh Hysteria node crashloops on cert obtain. Ask up front; this
# also seeds Caddy's contact field for renewal warnings on the panel's cert.
if [[ -z "$ACME_DEFAULT_EMAIL" && -r /dev/tty ]]; then
  printf 'Контактный email для Let'\''s Encrypt (получит уведомления о renewal'\''ах):\n'
  printf '  Используется и для Caddy панели, и автоматом подставляется в команду\n'
  printf '  установки Hysteria-нод как --hysteria-email.\n'
  printf '\n'
  printf 'Оставь пустым: придётся передавать email вручную при создании каждой ноды.\n'
  printf '\n'
  printf '\033[1;33mEmail:\033[0m '
  read -r ACME_DEFAULT_EMAIL </dev/tty || ACME_DEFAULT_EMAIL=""

  if [[ -n "$ACME_DEFAULT_EMAIL" ]]; then
    # Loose email check: must contain `@` and a `.` after it. Catches typos /
    # pasted strings with no dot in the TLD. LE itself rejects @example.com /
    # @example.net / @example.org as forbidden test domains.
    if [[ ! "$ACME_DEFAULT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
      printf '\033[1;31m"%s" не похож на email. Установка прервана.\033[0m\n' "$ACME_DEFAULT_EMAIL" >&2
      exit 1
    fi
    if [[ "$ACME_DEFAULT_EMAIL" =~ @(example\.com|example\.net|example\.org)$ ]]; then
      printf '\033[1;31m"%s": LE отвергает example.* как forbidden test domain. Введи реальный.\033[0m\n' "$ACME_DEFAULT_EMAIL" >&2
      exit 1
    fi
    log "Email для ACME: ${ACME_DEFAULT_EMAIL}"
  else
    log "Email не указан: install-команды для Hysteria/Naive-нод будут с placeholder, заполнишь вручную"
  fi
  printf '\n'
fi

step "Prerequisites"
if [[ ! -r /etc/os-release ]]; then
  fail "Cannot read /etc/os-release; only Ubuntu/Debian supported here"
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian are supported. Detected ID=${ID:-unknown}." ;;
esac
ok "$PRETTY_NAME"

# RAM / swap check: the panel-backend build (Prisma + native modules) OOMs on
# a 2 GB VPS without swap. Confirmed on a Hetzner CX22 (2 GB, no swap)
# 2026-05-19: pnpm install hangs forever, the BuildKit context dies. Auto-create
# a 4 GB swap file unless the operator opted out.
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
CURRENT_SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
ok "RAM: ${TOTAL_RAM_MB} MB · swap: ${CURRENT_SWAP_MB} MB"

if [[ "$TOTAL_RAM_MB" -lt 3500 && "$CURRENT_SWAP_MB" -lt 1000 ]]; then
  if [[ "${SKIP_SWAP:-0}" == "1" ]]; then
    warn "RAM=${TOTAL_RAM_MB} MB and swap is empty; Docker build will likely OOM."
    warn "SKIP_SWAP=1 was set, not creating swap. Build may hang or be killed."
  else
    SWAP_SIZE=${SWAP_SIZE_MB:-4096}
    log "Creating ${SWAP_SIZE} MB swap at /swapfile (small-RAM VPS insurance)"
    log "  (opt out with SKIP_SWAP=1 if you'd rather manage swap yourself)"
    # Re-run safe: a leftover /swapfile from a prior partial run may still be
    # ACTIVE swap, which makes dd/fallocate fail with "Text file busy". Disable
    # and remove it first so we can (re)create cleanly. Only /swapfile is
    # touched; any distro-default swap (e.g. /swap.img) is left alone.
    if [[ -e /swapfile ]]; then
      swapoff /swapfile 2>/dev/null || true
      rm -f /swapfile
    fi
    if ! fallocate -l "${SWAP_SIZE}M" /swapfile 2>/dev/null; then
      log "fallocate not supported on this FS, falling back to dd (slower)"
      dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE}" status=none
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q "^/swapfile" /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10 >/dev/null
    ok "swap online: $(free -h | awk '/^Swap:/ {print $2}') (persisted via /etc/fstab)"
  fi
fi

# ───── 2a. OS upgrade (idempotent) ─────
# Apply pending security + package updates before installing anything heavy.
# Opt-in: dist-upgrade is intrusive on alpha (reboots kernel, restarts sshd).
# Pass DO_OS_UPGRADE=1 if you actually want it; default is now off.
if [[ "${DO_OS_UPGRADE:-0}" == "1" ]]; then
  log "Upgrading OS packages (apt-get update + dist-upgrade)"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" dist-upgrade -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" autoremove -y
else
  # Even when skipping the full dist-upgrade, the apt package list still has
  # to be fresh: Ubuntu cloud images ship a stale cache from image-build day,
  # and `apt-get install <new package>` then fails with "Unable to locate
  # package" until the list is refreshed. Cheap (~3-5s), so always run it when
  # we're not doing the full upgrade.
  log "Refreshing apt package list"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
fi

step "Firewall (ufw)"
# Order matters: allow SSH FIRST so we don't lock ourselves out, only then
# flip the defaults to deny + enable.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  if ! command -v ufw >/dev/null; then
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y ufw
  fi
  ufw allow 22/tcp                       >/dev/null 2>&1 || true
  # 80+443 always open: needed for Caddy TLS + ACME HTTP-01 challenges
  ufw allow 80/tcp                       >/dev/null 2>&1 || true
  ufw allow 443/tcp                      >/dev/null 2>&1 || true
  # In domain mode, the SPA port stays internal (Caddy proxies 127.0.0.1:$FRONTEND_PORT).
  # In bare-IP / testing mode, expose it directly so the browser can hit it.
  if [[ -z "$PANEL_DOMAIN" ]]; then
    ufw allow "${FRONTEND_PORT}/tcp"     >/dev/null 2>&1 || true
  fi
  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable         >/dev/null
  if [[ -n "$PANEL_DOMAIN" ]]; then
    ok "allowed 22, 80, 443; default deny incoming (domain mode)"
  else
    ok "allowed 22, 80, 443, ${FRONTEND_PORT}; default deny incoming (bare-IP mode)"
  fi
else
  ok "skipped (SKIP_FIREWALL=1)"
fi

step "Docker + Compose"
# We used to do `curl -fsSL https://get.docker.com | sh` (unpinned, run as
# root). A compromise of get.docker.com, or a TLS MITM at install time, gave
# an attacker root on every panel install. Now we use Docker's official apt
# repository: the gpg key fetch is still trust-on-first-use (same TOFU window
# as before), but every later `apt-get install` verifies the .deb against this
# key, so once the keyring is set even a compromised mirror can't ship rogue
# binaries.
if ! command -v docker >/dev/null; then
  log "Installing Docker via official apt-repo (signed-by /etc/apt/keyrings/docker.gpg)"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -s /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" \
    "$(. /etc/os-release && echo "$VERSION_CODENAME")" \
    > /etc/apt/sources.list.d/docker.list
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Compose plugin should already be installed via docker-compose-plugin above,
# but legacy installs from get.docker.com may not have it.
if ! docker compose version >/dev/null 2>&1; then
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y docker-compose-plugin
fi
ok "$(docker --version | sed 's/Docker version //;s/, build.*//')"
ok "Compose $(docker compose version --short)"

# docker-compose.prod.yml uses `depends_on.<svc>.condition:
# service_completed_successfully` to gate on the migrate service. That
# condition landed in Docker Compose v2.20; older versions reject the compose
# file with a parse error like
#   "service_completed_successfully" is not a valid condition
# Ubuntu 22.04's apt-repo docker-compose-plugin shipped 2.17. Catch it up front
# so operators get a clear error, not a half-deployed stack.
COMPOSE_VER=$(docker compose version --short 2>/dev/null || echo "0.0.0")
COMPOSE_MAJOR=$(printf '%s' "$COMPOSE_VER" | cut -d. -f1)
COMPOSE_MINOR=$(printf '%s' "$COMPOSE_VER" | cut -d. -f2)
if [[ "$COMPOSE_MAJOR" -lt 2 ]] || { [[ "$COMPOSE_MAJOR" -eq 2 ]] && [[ "$COMPOSE_MINOR" -lt 20 ]]; }; then
  fail "Docker Compose ≥ 2.20.0 required (have $COMPOSE_VER). docker-compose.prod.yml uses 'service_completed_successfully' which older compose rejects. Upgrade docker-compose-plugin: apt-get install --only-upgrade docker-compose-plugin (after enabling Docker's apt repo per https://docs.docker.com/engine/install/)."
fi

step "Source checkout (${ICESLAB_REF})"
if [[ ! -d "$ICESLAB_DIR/.git" ]]; then
  log "Cloning $ICESLAB_REPO@$ICESLAB_REF into $ICESLAB_DIR"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y git
  # Full clone (NOT --depth 1 / single-branch): a shallow single-branch clone
  # leaves origin/main and other tags unreachable, so later `deploy.sh` /
  # updates get stuck on the pinned tag with no way forward (detached-HEAD
  # trap, caught live 2026-06-10). The repo is tiny, so a full clone is cheap.
  git clone --branch "$ICESLAB_REF" "$ICESLAB_REPO" "$ICESLAB_DIR"
else
  log "Updating existing checkout at $ICESLAB_DIR"
  # Detect operator-edited working tree before nuking it. The installer
  # auto-runs `git reset --hard` on every re-run, which silently wipes
  # any in-place patches an operator applied to debug a node. Refuse
  # unless they explicitly pass FORCE_RESET=1.
  if ! git -C "$ICESLAB_DIR" diff --quiet HEAD -- 2>/dev/null ||
     ! git -C "$ICESLAB_DIR" diff --quiet --cached HEAD -- 2>/dev/null; then
    if [[ "${FORCE_RESET:-0}" != "1" ]]; then
      fail "Checkout at $ICESLAB_DIR has uncommitted changes. Re-run with FORCE_RESET=1 to discard them, or stash before retrying."
    fi
    log "FORCE_RESET=1: discarding local edits in $ICESLAB_DIR"
  fi
  # Fetch ALL branches + tags (not --depth 1 / single ref) so origin/main and
  # new release tags stay reachable for future updates.
  git -C "$ICESLAB_DIR" fetch origin '+refs/heads/*:refs/remotes/origin/*' --tags --prune
  git -C "$ICESLAB_DIR" checkout --force "$ICESLAB_REF"
  git -C "$ICESLAB_DIR" reset --hard "origin/$ICESLAB_REF" 2>/dev/null || true
fi

# GitHub tags are mutable: if the upstream repo or a maintainer token is
# compromised, an attacker can re-point v0.1.7 at a hostile commit. Operators
# who care can pin the expected commit SHA via ICESLAB_REF_SHA; we then verify
# the checkout matches and abort if the tag was re-pointed since that SHA was
# published.
if [[ -n "${ICESLAB_REF_SHA:-}" ]]; then
  actual_sha=$(git -C "$ICESLAB_DIR" rev-parse HEAD)
  if [[ "$actual_sha" != "$ICESLAB_REF_SHA" ]]; then
    fail "ICESLAB_REF_SHA mismatch: tag $ICESLAB_REF resolved to $actual_sha, expected $ICESLAB_REF_SHA. Tag may have been re-pointed upstream, aborting."
  fi
  ok "commit SHA verified ($actual_sha)"
fi
cd "$ICESLAB_DIR"

step "Configuration (.env.production)"
ENV_FILE="$ICESLAB_DIR/.env.production"
if [[ -f "$ENV_FILE" ]]; then
  ok ".env.production already exists, keeping current secrets"
else
  log "Generating with fresh secrets (openssl rand -hex)"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y openssl >/dev/null 2>&1 || true
  PG_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  if [[ -n "$PANEL_DOMAIN" ]]; then
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-https://${PANEL_DOMAIN}}
    PUBLIC_URL_VAL=${PUBLIC_URL:-https://${PANEL_DOMAIN}}
  else
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-http://${PUBLIC_IP}:${FRONTEND_PORT}}
    PUBLIC_URL_VAL=${PUBLIC_URL:-http://${PUBLIC_IP}:${FRONTEND_PORT}}
  fi
  cat > "$ENV_FILE" <<EOF
# Generated by install-iceslab.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_USER=iceslab
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=iceslab

DATABASE_URL=postgres://iceslab:${PG_PASSWORD}@postgres:5432/iceslab
REDIS_URL=redis://redis:6379

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
LOG_LEVEL=info

CORS_ORIGIN=${CORS_ORIGIN_VAL}
PUBLIC_URL=${PUBLIC_URL_VAL}
FRONTEND_PORT=${FRONTEND_PORT}

# ───── security & alerts ─────
# TRUST_PROXY_HOPS: 2 = Cloudflare + Caddy (default deploy). Lower if
# you don't run CF in front. Higher = attackers can spoof X-Forwarded-For.
TRUST_PROXY_HOPS=2

# Per-route rate limits + login lockout (defaults are fine for small panel).
RATE_LIMIT_SUB_PER_MIN=30
RATE_LIMIT_BOOTSTRAP_PER_MIN=10
RATE_LIMIT_HEARTBEAT_PER_MIN=120
LOGIN_LOCKOUT_FAILURES=10
LOGIN_LOCKOUT_DURATION_MIN=5
LOGIN_LOCKOUT_WINDOW_MIN=10

# ACME contact email auto-injected into Hysteria/Naive install commands.
# Leave empty to make the UI emit a placeholder admin fills manually.
ACME_DEFAULT_EMAIL=${ACME_DEFAULT_EMAIL}

# Telegram alerts (Tier-1). Empty = disabled, set both to enable. See
# .env.production.example for what fires.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Geo-block /api/* by CF-IPCountry. Empty = disabled. Requires Cloudflare
# orange-cloud + CF-IPCountry header.
ADMIN_ALLOWED_COUNTRIES=

# Honeypot scanner-trap blacklist TTL (seconds).
HONEYPOT_BLACKLIST_TTL_SEC=3600

# Honey-user tripwire: tokens admin plants in suspicious places. Any hit
# on /sub/<honey> fires Telegram alert + IP blacklist. CSV. Empty = disabled.
HONEY_USER_TOKENS=
EOF
  chmod 600 "$ENV_FILE"
fi

step "Pre-pull base images"
# Pulling these in parallel before the build keeps the build stages from
# competing for bandwidth, steadies build time, and gives the operator visible
# progress instead of a silent first-run delay.
# Tags MUST match the Dockerfile ARGs / compose images, else the pre-pull
# caches an image the build never uses (we once had node:22-alpine vs the
# Dockerfile's 22.22-alpine, and golang:1.23 vs 1.22: both dead pulls).
log "Caching postgres:16-alpine, redis:7-alpine, nginx:1.27-alpine, node:22.22-alpine, golang:1.22-alpine"
docker pull postgres:16-alpine >/dev/null 2>&1 &
docker pull redis:7-alpine >/dev/null 2>&1 &
docker pull nginx:1.27-alpine >/dev/null 2>&1 &
docker pull node:22.22-alpine >/dev/null 2>&1 &
docker pull golang:1.22-alpine >/dev/null 2>&1 &
wait
ok "base images cached locally"

step "Build images (first run ≈ 5-10 min)"
# --progress=plain shows real-time build output instead of a collapsing summary.
# Critical for low-RAM VPS where operators can't tell stuck-vs-slow without it.
# COMPOSE_PARALLEL_LIMIT=1 forces backend and frontend to build sequentially,
# halving peak memory pressure (backend builder + frontend builder otherwise
# both run pnpm install at the same time = 2× RAM spike).
COMPOSE_PARALLEL_LIMIT=1 DOCKER_BUILDKIT=1 \
  docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" build --progress=plain

step "Database migrations"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm migrate

step "Launch stack + health check"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T backend \
       wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"status":"ok"'; then
    ok "backend healthy in ${i}s"
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    warn "Backend didn't reach /health within 60s, check logs:"
    warn "  docker compose -f $ICESLAB_DIR/docker-compose.prod.yml logs backend"
  fi
done

if [[ -n "$PANEL_DOMAIN" ]]; then
  step "Caddy + TLS for ${PANEL_DOMAIN}"
  if ! command -v caddy >/dev/null; then
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y caddy
  fi
  # Access log emitted to /var/log/caddy/access.log so fail2ban can read it
  # (next step). JSON format keeps client_ip / status / uri reliably parsable
  # for the iceslab-auth-bf and iceslab-probe-bf jails. /var/log/caddy is
  # created by the caddy deb package; mode 0755 is its default.
  cat > /etc/caddy/Caddyfile <<EOF
${PANEL_DOMAIN} {
  log {
    output file /var/log/caddy/access.log
    format json
  }
  reverse_proxy 127.0.0.1:${FRONTEND_PORT}
}

# Anti-probing: bare-IP / unknown hostname requests on :443 get a silent 204
# so scanners can't fingerprint Iceslab.
:443 {
  tls internal
  respond 204
}
EOF
  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl reload caddy || systemctl restart caddy
  ok "TLS will be issued by Let's Encrypt on first request"

  # Network-layer brute-force / probe defense. The Fastify rate limit +
  # per-(IP+username) lockout handle the request-level cases; fail2ban kicks in
  # earlier (drops packets at iptables/nft) so sustained bot traffic doesn't
  # cost us CPU/IO. Caveat: an iptables-level ban only works for direct
  # connections. If Cloudflare or another reverse proxy fronts Caddy, fail2ban
  # sees CF IPs in the log (or client_ip via the upstream-restored field) and
  # can't block CF at the firewall. For CF deploys, add a CF WAF rule instead
  # (docs/SECURITY.md, TODO).
  step "fail2ban (auth brute-force + probe scanner jails)"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y fail2ban
  install -d -m 0755 /etc/fail2ban/filter.d /etc/fail2ban/jail.d
  cat > /etc/fail2ban/filter.d/iceslab-auth-bf.conf <<'EOF'
# Match 401/429 responses on /api/auth/login in Caddy's JSON access log.
# <HOST> binds to client_ip so banned addr is the real upstream IP when
# trusted_proxies is set; with direct (no proxy) traffic it's the same as
# remote_ip. Order of "uri" vs "status" in JSON is stable inside one Caddy
# release; .* between them tolerates field reordering across versions.
[Definition]
failregex = "client_ip":"<HOST>".*"uri":"/api/auth/login".*"status":(401|429)
ignoreregex =
EOF
  cat > /etc/fail2ban/filter.d/iceslab-probe-bf.conf <<'EOF'
# Match obvious probe scanners. We do NOT serve WordPress / phpMyAdmin /
# .env / .git, so a single hit is high-signal: it's a scanner. 3-strike
# threshold lets a hand-typed mistype through.
[Definition]
failregex = "client_ip":"<HOST>".*"uri":"/(wp-login\.php|wp-admin|\.env|\.git/config|phpmyadmin|xmlrpc\.php)
ignoreregex =
EOF
  cat > /etc/fail2ban/jail.d/iceslab.local <<'EOF'
[iceslab-auth-bf]
enabled  = true
filter   = iceslab-auth-bf
logpath  = /var/log/caddy/access.log
maxretry = 10
findtime = 1h
bantime  = 24h
backend  = polling

[iceslab-probe-bf]
enabled  = true
filter   = iceslab-probe-bf
logpath  = /var/log/caddy/access.log
maxretry = 3
findtime = 1h
bantime  = 7d
backend  = polling
EOF
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban
  ok "fail2ban active: iceslab-auth-bf (10/1h → 24h ban), iceslab-probe-bf (3/1h → 7d ban)"
fi

PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
if [[ -n "$PANEL_DOMAIN" ]]; then
  SPA_URL="https://${PANEL_DOMAIN}"
else
  SPA_URL="http://${PUBLIC_IP}:${FRONTEND_PORT}"
fi

# Final per-step duration (last step doesn't get one from the next step() call).
printf '\033[2m       step %d done in %s\033[0m\n' "$STEP_N" "$(elapsed_step)"

printf '\n'
printf '\033[1;32m──────────────────────────────────────────────────────────────\033[0m\n'
printf '\033[1;32m  ✓ Iceslab is up\033[0m  \033[2m(total %s)\033[0m\n' "$(elapsed_total)"
printf '\033[1;32m──────────────────────────────────────────────────────────────\033[0m\n'
printf '\n'
printf '  SPA          %s\n' "$SPA_URL"
printf '  Install dir  %s\n' "$ICESLAB_DIR"
printf '  Env file     %s  (chmod 600)\n' "$ENV_FILE"
printf '\n'
printf '  Next:  open the SPA → click "Create first admin"\n'
printf '\n'
if [[ -z "$PANEL_DOMAIN" ]]; then
  printf '\033[1;33m  ⚠  Plain HTTP on :%s, fine for testing, NOT for production.\033[0m\n' "$FRONTEND_PORT"
  printf '     For TLS: re-run with PANEL_DOMAIN=panel.example.com\n'
  printf '\n'
fi
printf '  Logs       cd %s && docker compose -f docker-compose.prod.yml --env-file .env.production logs -f\n' "$ICESLAB_DIR"
printf '  Restart    docker compose -f docker-compose.prod.yml --env-file .env.production restart backend\n'
printf '  Update     git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build\n'
printf '\n'
