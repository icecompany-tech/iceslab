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
        git checkout -B "$SYNC_TARGET" "origin/$SYNC_TARGET"   # branch: track + advance
    else
        git checkout --force "$SYNC_TARGET"                    # tag/sha: pinned checkout
    fi
    SHA_AFTER=$(git_short_sha)
}
