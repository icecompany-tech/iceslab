# shellcheck shell=bash
#
# _lib.sh: shared helpers for ops scripts (deploy*, cleanup, logs, backup,
# restore). Not meant to be executed directly. Source it from a script that
# has already set LIB_PREFIX:
#
#   LIB_PREFIX="deploy"
#   source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
#
# Provides:
#   - color helpers (auto-disabled when stdout isn't a TTY)
#   - log_info / log_ok / log_warn / log_err  (consistent prefix + colors)
#   - elapsed_total / fmt_duration  (wall-clock since script start)
#   - step / step_done  (numbered "[N/M] doing X" headers with timing)
#   - on_err trap installer  (prints which line + command failed)
#   - require_compose_root  (ensures we're in /opt/iceslab or equivalent)
#   - git_short_sha  (current HEAD hash, "no-git" if not a repo)
#   - write_caddyfile / refresh_host_caddyfile  (the host Caddy's file, A-267)
#
# Install scripts (install-iceslab.sh, install-iceslab-node.sh) deliberately
# do not source this: they're curl-piped standalone and must work without
# the rest of the scripts/ directory present.

# ───── Colors ─────
# Only emit escape codes on an interactive TTY. CI logs, pipes, and
# journalctl capture as plain text, so escapes would just clutter them.
if [[ -t 1 ]]; then
    C_INFO=$'\033[1;36m'   # cyan
    C_OK=$'\033[1;32m'     # green
    C_WARN=$'\033[1;33m'   # yellow
    C_ERR=$'\033[1;31m'    # red
    C_DIM=$'\033[2m'
    C_RST=$'\033[0m'
else
    C_INFO=; C_OK=; C_WARN=; C_ERR=; C_DIM=; C_RST=
fi

# ───── Timing ─────
# Use SECONDS (bash builtin) to avoid spawning `date` on every log line.
# Subtraction gives wall-clock seconds since the library was sourced.
_LIB_START_SECONDS=$SECONDS
_LIB_STEP_SECONDS=$SECONDS
# Label of the currently-running step, set by step(); on_err prints it so a
# failure names the phase ("rebuild", "prisma migrate deploy"), not just a line.
_LIB_CURRENT_STEP=""

fmt_duration() {
    # Format seconds as "Xs" / "XmYs" / "XhYm" by scale.
    local s=$1
    if (( s < 60 )); then
        printf '%ds' "$s"
    elif (( s < 3600 )); then
        printf '%dm%ds' $((s/60)) $((s%60))
    else
        printf '%dh%dm' $((s/3600)) $(((s%3600)/60))
    fi
}

elapsed_total() { fmt_duration $((SECONDS - _LIB_START_SECONDS)); }
elapsed_step()  { fmt_duration $((SECONDS - _LIB_STEP_SECONDS)); }

# ───── Logging ─────
# Caller sets LIB_PREFIX to a short tag (deploy / cleanup / backup / etc).
# Falls back to script basename if unset.
LIB_PREFIX="${LIB_PREFIX:-$(basename "${0:-script}" .sh)}"

log_info() { printf '%b[%s]%b %s\n' "$C_INFO" "$LIB_PREFIX" "$C_RST" "$*"; }
log_ok()   { printf '%b[%s]%b %b%s%b\n' "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_OK" "$*" "$C_RST"; }
log_warn() { printf '%b[%s]%b %b%s%b\n' "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_WARN" "$*" "$C_RST" >&2; }
log_err()  { printf '%b[%s]%b %b%s%b\n' "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_ERR" "$*" "$C_RST" >&2; }

# ───── Numbered steps ─────
# Show "step 3 of 7" + per-step timing so a long deploy doesn't look hung.
# Mirrors the [N/M] pattern in install-iceslab.sh.
#
#   STEP_TOTAL=4
#   step 1 "git pull"
#     git pull --ff-only
#   step_done
#
STEP_TOTAL="${STEP_TOTAL:-?}"

step() {
    local n=$1
    shift
    _LIB_STEP_SECONDS=$SECONDS
    _LIB_CURRENT_STEP="[${n}/${STEP_TOTAL}] $*"
    printf '\n%b[%s]%b %b[%s/%s]%b %s %b(+%s total)%b\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" \
        "$C_INFO" "$n" "$STEP_TOTAL" "$C_RST" \
        "$*" \
        "$C_DIM" "$(elapsed_total)" "$C_RST"
}

step_done() {
    printf '%b[%s]%b   %b✓ done in %s%b\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" \
        "$C_OK" "$(elapsed_step)" "$C_RST"
}

# ───── Resilience ─────
# retry <max> <cmd...>: run cmd; on failure retry up to <max> times total with a
# linear backoff, logging each attempt. For network-flaky steps (docker / pnpm /
# prisma image + engine pulls) where a transient ECONNRESET / ETIMEDOUT should
# not sink the whole deploy. Returns the last exit code if every attempt fails,
# so the caller's `set -e` + ERR trap still fire with a clear message.
retry() {
    local max=$1
    shift
    local attempt=1 rc=0
    while (( attempt <= max )); do
        if "$@"; then
            return 0
        fi
        rc=$?
        if (( attempt < max )); then
            log_warn "attempt ${attempt}/${max} failed (exit ${rc}); retry in $((attempt * 5))s"
            sleep $(( attempt * 5 ))
        else
            log_err "all ${max} attempts failed (exit ${rc})"
        fi
        attempt=$(( attempt + 1 ))
    done
    return "$rc"
}

# ───── Error context ─────
# Without an ERR trap, `set -e` aborts on the failing command but the
# operator only sees the line that exited, with no idea which command.
# This trap prints exit code + line number + the command text (read back
# from the script source) so journalctl debugging shows the actual command.
#
# Caller installs:
#   trap 'on_err $LINENO' ERR

on_err() {
    local exit_code=$?
    local line=$1
    local src cmd
    # Best-effort: grab the failing line back from the script source.
    # Won't work if the script is being piped via stdin (`<(curl)`) but
    # ops scripts here are always run from disk.
    src="${BASH_SOURCE[1]:-$0}"
    cmd=$(sed -n "${line}p" "$src" 2>/dev/null | sed 's/^[[:space:]]*//' || echo '?')
    printf '\n%b[%s]%b %b═══ FAILED ═══%b\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_ERR" "$C_RST" >&2
    printf '%b[%s]%b   step:    %s\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "${_LIB_CURRENT_STEP:-?}" >&2
    printf '%b[%s]%b   line:    %s (in %s)\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$line" "$(basename "$src")" >&2
    printf '%b[%s]%b   command: %s\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$cmd" >&2
    printf '%b[%s]%b   exit:    %s\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$exit_code" >&2
    printf '%b[%s]%b   elapsed: %s\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$(elapsed_total)" >&2
    printf '%b[%s]%b   %bhint:%b transient network/registry pulls or DB-not-ready are safe to re-run (bash scripts/deploy.sh); a migration or config error shown above is real and needs a fix.\n' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_DIM" "$C_RST" >&2
    exit "$exit_code"
}

# ───── Pre-flight ─────
# Most ops scripts assume CWD is the panel project root (where the compose
# file + .env.production sit). Bail with a useful message instead of a
# cryptic docker-compose error if invoked from the wrong directory.
require_compose_root() {
    local compose="${COMPOSE_FILE:-docker-compose.prod.yml}"
    local env="${ENV_FILE:-.env.production}"
    if [[ -f "$compose" && -f "$env" ]]; then
        return 0
    fi
    # Not in the project root (operators run from scripts/, scripts/ops/, or via
    # iceslab.sh). Walk UP from this lib's own dir until the compose + env pair
    # appears, so it works no matter how deep scripts/ is nested. Caught live
    # 2026-06-09: deploy run from /opt/iceslab/scripts.
    local dir
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || dir=""
    while [[ -n "$dir" && "$dir" != "/" ]]; do
        if [[ -f "$dir/$compose" && -f "$dir/$env" ]]; then
            cd "$dir"
            log_info "switched to project root: $dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    log_err "run from panel project root, missing $compose or $env"
    log_err "  (try: cd /opt/iceslab)"
    exit 1
}

# ───── Git helpers ─────
git_short_sha() {
    git rev-parse --short HEAD 2>/dev/null || echo "no-git"
}

git_short_sha_or_die() {
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        log_err "git_short_sha_or_die: not a git repository"
        exit 1
    fi
    git rev-parse --short HEAD
}

# git_sync_to_ref: bring the checkout to ICESLAB_REF (a branch like `main`, or a
# pinned tag like v0.1.4). When ICESLAB_REF is unset it uses the checked-out
# branch, or falls back to `main` when HEAD is detached (the state the installer
# leaves), so an unattended `deploy.sh` just tracks the trunk with no flags.
# Replaces a bare `git pull --ff-only`, which silently no-ops on that tag-pinned
# detached HEAD, so operators rebuilt stale code thinking they had updated
# (caught live 2026-06-10, a panel stuck rebuilding v0.1.2). Fetches all branches
# + tags (overriding the single-branch refspec a shallow install clone leaves),
# then checks out the target explicitly. Pin a release with ICESLAB_REF=<tag>.
#
# Sets globals for the caller to log: SHA_BEFORE, SHA_AFTER, SYNC_TARGET.
# Honors FORCE_RESET=1 to discard local edits. Exits non-zero on bad state.
git_sync_to_ref() {
    SHA_BEFORE=$(git_short_sha)
    SYNC_TARGET="${ICESLAB_REF:-}"
    if [[ -z "$SYNC_TARGET" ]]; then
        # Prefer the checked-out branch. If HEAD is detached (the installer pins a
        # tag/sha, so a fresh box lands here) and no ICESLAB_REF was given, default
        # to `main` instead of stopping: an unattended deploy should just track the
        # trunk. The checkout below re-attaches HEAD to that branch, so this only
        # fires once per detached box. Pin a release with ICESLAB_REF=<tag> to hold.
        SYNC_TARGET=$(git symbolic-ref --short -q HEAD || true)
        if [[ -z "$SYNC_TARGET" ]]; then
            SYNC_TARGET="main"
            log_warn "Detached HEAD and ICESLAB_REF unset; defaulting to 'main' (set ICESLAB_REF=<tag> to pin a release)."
        fi
    fi
    if [[ -n "$(git status --porcelain)" && "${FORCE_RESET:-0}" != "1" ]]; then
        log_err "Working tree has local changes; refusing to switch/reset refs."
        log_err "Commit or stash them, or re-run with FORCE_RESET=1 to discard."
        exit 1
    fi
    # --force on the fetch: a re-pointed tag makes plain `--tags` report "would
    # clobber existing tag" and exit non-zero, which under `set -e` aborts the
    # deploy at the sync step. Force tags to match origin (the deploy's source of
    # truth) so re-deploys stay unblocked.
    git fetch --force origin '+refs/heads/*:refs/remotes/origin/*' --tags --prune
    if git show-ref --verify --quiet "refs/remotes/origin/${SYNC_TARGET}"; then
        # branch: track + advance. FORCE_RESET adds -f so local dirt (e.g. a
        # manual chmod on a Linux deploy box, which git sees as a mode change)
        # can't block the branch checkout. Without FORCE_RESET the dirty-tree
        # guard above already bailed, so this path only runs clean or forced.
        if [[ "${FORCE_RESET:-0}" == "1" ]]; then
            git checkout --force -B "$SYNC_TARGET" "origin/$SYNC_TARGET"
        else
            git checkout -B "$SYNC_TARGET" "origin/$SYNC_TARGET"
        fi
    else
        git checkout --force "$SYNC_TARGET"                    # tag/sha: pinned checkout
    fi
    SHA_AFTER=$(git_short_sha)
}

# deploy_self_sum <script>: sha256 of a deploy script and of this library
# together, as they are on disk now.
deploy_self_sum() {
    cat "$1" "${BASH_SOURCE[0]}" | sha256sum | cut -d' ' -f1
}

# reexec_if_updated <sum before> <script> [args...]: after git_sync_to_ref,
# start the script again when the sync changed it or this library, with the
# same arguments and environment. bash keeps executing the copy it already
# read, and this library was sourced before the sync, so without this a step
# added in the new version (step 5, the host Caddy) is skipped by the very
# deploy that brings it, and only the next deploy runs it (26.10, the stand,
# updated from a v0.2.1-era checkout: Caddyfile not re-rendered).
# ICESLAB_DEPLOY_REEXEC=1 marks the second run: it does not sync again and
# never hands over a second time, so a script that changes itself on every
# sync cannot loop. SHA_BEFORE goes along for the step 1 line.
reexec_if_updated() {
    local before="$1" script="$2"
    shift 2
    [[ "${ICESLAB_DEPLOY_REEXEC:-0}" == 1 ]] && return 0
    [[ "$(deploy_self_sum "$script")" == "$before" ]] && return 0
    log_info "the sync changed $(basename "$script") or _lib.sh: handing over to the new one"
    ICESLAB_DEPLOY_REEXEC=1 SHA_BEFORE="${SHA_BEFORE:-}" exec bash "$script" "$@"
}

# ───── Host Caddy (A-267) ─────
# The installer writes /etc/caddy/Caddyfile once, in domain mode. A fix to that
# file (the masked logs of A-267) would otherwise never reach a panel that is
# already installed: every operator who updated would keep a Caddy writing
# subscription tokens into access.log. deploy.sh calls refresh_host_caddyfile,
# which renders the file again with write_caddyfile below.

# write_caddyfile <path>: a copy of the installer's, byte for byte (the
# installer runs curl-piped and cannot source this file); the reasons for every
# line are written out there. bootstrap_checks_test.go holds the two together.
write_caddyfile() {
  local prefix="${SUB_PREFIX:-/sub}"
  # The backend's own rule for the prefix (config.ts): anything else and the
  # backend refuses to start, so falling back cannot hide a working setup.
  [[ "$prefix" =~ ^/[A-Za-z0-9_-]+$ ]] || prefix=/sub
  cat > "$1" <<EOF
# Caddy's error log (http.log.error, a failed upstream and the like) carries
# the request, uri and address included, into journald. Not silenced, the
# upstream's diagnostics are needed: taken out of the default logger and
# written by its own, with the same mask as the access log below.
{
  log default {
    exclude http.log.error
  }
  log iceslab_errors {
    include http.log.error
    format filter {
      wrap json
      request>uri regexp "^(${prefix}/|/api/internal/bootstrap/|/api/users/by-subscription-token/|/api/settings/subscription/preview/)[^/?]+" "\${1}<token>"
      request>client_ip ip_mask 24 48
      request>remote_ip ip_mask 24 48
    }
  }
  # Cloudflare's addresses (A-009), from https://www.cloudflare.com/ips-v4 and
  # /ips-v6 as of 2026-10-31. A request from one of them keeps the
  # X-Forwarded-For Cloudflare sends, so the panel sees the client behind it;
  # from anywhere else Caddy replaces the header with the address it got the
  # request from. The list changes with this file: a deploy re-renders it.
  servers {
    trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
  }
}

${PANEL_DOMAIN} {
  log iceslab_secret_paths {
    output file /var/log/caddy/access-masked.log {
      roll_size 10MiB
      roll_keep 5
      roll_keep_for 168h
    }
    format filter {
      wrap json
      request>uri regexp "^(${prefix}/|/api/internal/bootstrap/|/api/users/by-subscription-token/|/api/settings/subscription/preview/)[^/?]+" "\${1}<token>"
      request>client_ip ip_mask 24 48
      request>remote_ip ip_mask 24 48
    }
  }
  log iceslab_access {
    output file /var/log/caddy/access.log
    format json
  }
  @secret_paths path ${prefix}/* /api/internal/bootstrap/* /api/users/by-subscription-token/* /api/settings/subscription/preview/*
  @other_paths not path ${prefix}/* /api/internal/bootstrap/* /api/users/by-subscription-token/* /api/settings/subscription/preview/*
  log_name @secret_paths iceslab_secret_paths
  log_name @other_paths iceslab_access
  reverse_proxy 127.0.0.1:${FRONTEND_PORT}
}

# Anti-probing: bare-IP / unknown hostname requests on :443 get a silent 204
# so scanners can't fingerprint Iceslab.
:443 {
  tls internal
  respond 204
}
EOF
}

# prepare_caddy_logs <Caddyfile>: every `output file` the Caddyfile names is
# there and belongs to the user the caddy service runs as (User= of its unit,
# caddy by default), before Caddy loads the file. A log Caddy cannot open fails
# the whole reload. 26.10 on the stand: `caddy validate`, run as root, opened
# the new access-masked.log and left it root:root 0600, and the reload, running
# as caddy, got permission denied. The directory is made writable for that user
# too, because rotation (roll_size) renames files in it. Same text in
# scripts/install-iceslab.sh; caddyfile_test.go holds the two together.
prepare_caddy_logs() {
  local u g f d
  u="$(systemctl show -p User --value caddy 2>/dev/null || true)"
  u="${u:-caddy}"
  id -u "$u" >/dev/null 2>&1 || return 0
  g="$(id -gn "$u")"
  while read -r f; do
    [[ -n "$f" ]] || continue
    d="$(dirname "$f")"
    [[ -d "$d" ]] || install -d -o "$u" -g "$g" -m 0750 "$d"
    if ! command -v runuser >/dev/null 2>&1 || ! runuser -u "$u" -- test -w "$d" 2>/dev/null; then
      chown "$u:$g" "$d"
    fi
    [[ -e "$f" ]] || install -o "$u" -g "$g" -m 0640 /dev/null "$f"
    chown "$u:$g" "$f"
  done < <(sed -nE 's/^[[:space:]]*output file ([^[:space:]{]+).*/\1/p' "$1")
}

# The file every installer up to v0.2.1 wrote, for a domain and a port. A
# panel installed then has no stamp, and a file equal to this is still ours.
legacy_caddyfile_v1() {
    cat <<EOF
$1 {
  log {
    output file /var/log/caddy/access.log
    format json
  }
  reverse_proxy 127.0.0.1:$2
}

# Anti-probing: bare-IP / unknown hostname requests on :443 get a silent 204
# so scanners can't fingerprint Iceslab.
:443 {
  tls internal
  respond 204
}
EOF
}

# refresh_host_caddyfile: render the host Caddyfile again and reload Caddy,
# only when the file there is still the one we wrote. Ours is a file whose
# sha256 matches the stamp the installer (or a previous refresh) left beside
# it, or, with no stamp, exactly the v0.2.1 file for its own domain and port.
# Anything else was edited by the operator and is left alone, in words. The
# domain and the port come from the file in place (that is what serves today),
# the subscription prefix from .env.production. Every refusal is a warning,
# never a failed deploy: the panel itself is already up by now.
#
#   CADDYFILE_PATH  default /etc/caddy/Caddyfile
#   ENV_FILE        the deploy's own, for SUBSCRIPTION_PATH_PREFIX
refresh_host_caddyfile() {
    local file="${CADDYFILE_PATH:-/etc/caddy/Caddyfile}"
    local stamp domain port have prefix tmp backup
    stamp="$(dirname "$file")/.iceslab-caddyfile.sha256"
    if [[ ! -f "$file" ]] || ! command -v caddy >/dev/null 2>&1; then
        log_info "no host Caddy here (bare-IP install), nothing to refresh"
        return 0
    fi
    # The first site address: the global block is a bare `{`, :443 starts with
    # a colon. `q` stops at the first match, so no pipe into head.
    domain="$(sed -nE '/^[^:{#[:space:]][^[:space:]]* \{$/{s/ \{$//p;q}' "$file")"
    port="$(sed -nE '/^[[:space:]]*reverse_proxy 127\.0\.0\.1:[0-9]+$/{s/.*://p;q}' "$file")"
    if [[ -z "$domain" || -z "$port" ]]; then
        log_warn "$file has no site and reverse_proxy of ours; not touched"
        return 0
    fi
    have="$(sha256sum "$file" | cut -d' ' -f1)"
    if ! { [[ -f "$stamp" && "$(cat "$stamp")" == "$have" ]] ||
           [[ "$(cat "$file")" == "$(legacy_caddyfile_v1 "$domain" "$port")" ]]; }; then
        log_warn "$file was edited by hand since the installer wrote it; not rewritten."
        log_warn "  The panel's version masks subscription and bootstrap tokens in Caddy's logs (A-267):"
        log_warn "  see write_caddyfile in scripts/ops/_lib.sh and carry it over by hand."
        return 0
    fi
    if [[ ! -w "$(dirname "$file")" ]]; then
        log_warn "cannot write $file (run deploy.sh as root); Caddy keeps its old file"
        return 0
    fi
    prefix="$(sed -n 's/^SUBSCRIPTION_PATH_PREFIX=//p' "${ENV_FILE:-.env.production}" 2>/dev/null | tail -n 1 || true)"
    tmp="$(mktemp)"
    PANEL_DOMAIN="$domain" FRONTEND_PORT="$port" SUB_PREFIX="$prefix" write_caddyfile "$tmp"
    if cmp -s "$tmp" "$file"; then
        rm -f "$tmp"
        # The file is current, its logs may not be: a deploy before A-273 ran
        # validate as root and left a log root:root, which Caddy cannot open
        # on its next start (26.10, the stand). Nothing is reloaded for it.
        prepare_caddy_logs "$file"
        log_info "host Caddyfile already current"
        caddy_restart_if_stale_logs "$file"
        return 0
    fi
    # The logs first: validate runs as root and opens every log the new file
    # names, and a log it has to create is left root:root 0600, which the
    # reload, running as caddy, cannot open (A-273, the stand 26.10).
    prepare_caddy_logs "$tmp"
    if ! caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
        rm -f "$tmp"
        log_warn "the new Caddyfile does not validate; Caddy keeps its old file"
        return 0
    fi
    backup="${file}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p "$file" "$backup"
    cat "$tmp" > "$file"
    rm -f "$tmp"
    # Once more before the reload: whatever validate touched is the caddy
    # user's again.
    prepare_caddy_logs "$file"
    if systemctl reload caddy; then
        sha256sum "$file" | cut -d' ' -f1 > "$stamp"
        log_ok "host Caddyfile re-rendered for ${domain} and Caddy reloaded (previous kept as ${backup})"
        caddy_restart_if_stale_logs "$file"
    else
        cp -p "$backup" "$file"
        systemctl reload caddy || true
        log_warn "Caddy refused the new file on reload; the previous one is back in place"
    fi
}

# caddy_restart_if_stale_logs <Caddyfile>: restart Caddy when it writes a log
# the Caddyfile names into a file that is no longer on disk.
#
# Caddy never closes a file log on reload: the config's cleanup that would
# (Logging.closeLogs) is registered on a copy of the context and never runs
# (caddy v2.11.4: logging.go:86-93 openLogs takes the Context by value and
# calls OnCancel on it; context.go:73-95 the cancel runs the parent's
# cleanupFuncs). The writer stays in the pool (logging.go:250-252, :806), and
# every later config that names the same file gets that writer back instead
# of opening the file. So a log removed under a running Caddy is written into
# the removed file until Caddy restarts, and a reload does not change that:
# 26.10 on the stand, access-masked.log removed, two reloads later still
# «(deleted)» in /proc/<pid>/fd, the masked lines lost. A restart opens every
# log afresh; it costs a second or two of the panel being unreachable, which
# is why it happens only when a removed file is actually held.
#
#   CADDY_PROC  default /proc (a test points it elsewhere)
caddy_restart_if_stale_logs() {
    local proc="${CADDY_PROC:-/proc}" pid fd t named stale=""
    pid="$(systemctl show -p MainPID --value caddy 2>/dev/null || true)"
    [[ -n "$pid" && "$pid" != 0 && -d "$proc/$pid/fd" ]] || return 0
    named="$(sed -nE 's/^[[:space:]]*output file ([^[:space:]{]+).*/\1/p' "$1")"
    for fd in "$proc/$pid/fd/"*; do
        t="$(readlink "$fd" 2>/dev/null)" || continue
        [[ "$t" == *" (deleted)" ]] || continue
        if grep -qxF "${t% (deleted)}" <<<"$named"; then
            stale+="${t% (deleted)} "
        fi
    done
    [[ -n "$stale" ]] || return 0
    log_warn "Caddy writes ${stale% } into a removed file (a reload keeps an open log); restarting Caddy"
    if systemctl restart caddy && [[ "$(systemctl is-active caddy 2>/dev/null || true)" == active ]]; then
        log_ok "Caddy restarted, its logs are open afresh"
    else
        log_warn "Caddy did not come back after the restart: check 'systemctl status caddy' and 'journalctl -u caddy'"
    fi
}
