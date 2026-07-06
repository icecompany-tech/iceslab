#!/usr/bin/env bash
# deploy.sh: full panel re-deploy
#
# Pulls latest code, applies new Prisma migrations, rebuilds all containers
# (--no-cache by default so an nginx.conf / dist / env change never lands on
# a stale layer), then prints status and a tail of the backend log so you can
# catch a startup error before tabbing away.
#
# Usage:
#   ./scripts/deploy.sh             # re-deploy (--no-cache default)
#   ./scripts/deploy.sh --cache     # skip --no-cache for a faster deploy when
#                                     you only changed code, not nginx.conf or
#                                     the Dockerfile
#   ./scripts/deploy.sh --cleanup   # also prune old images/build cache after
#                                     the rebuild lands
#
# Run from the panel project root (where docker-compose.prod.yml lives).

set -euo pipefail

LIB_PREFIX="deploy"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Args ─────
CLEANUP_AFTER=0
NO_CACHE=1   # default on: ~30s cost buys "what I see is what shipped"
for arg in "$@"; do
    case "$arg" in
        --cleanup|--prune) CLEANUP_AFTER=1 ;;
        --cache)           NO_CACHE=0 ;;
        --no-cache)        NO_CACHE=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log_err "unknown arg: $arg"
            exit 2
            ;;
    esac
done

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
require_compose_root

# ───── Safety: snapshot the secrets file before touching anything ─────
# .env.production is the only copy of JWT_SECRET, POSTGRES_PASSWORD and the
# node mTLS CA on this host. A bad edit or git op could wipe it, taking every
# node's trust and every admin session with it. Keep a ring of timestamped
# copies (last 5) next to it. cp -p preserves the 600 perms.
if [[ -f "$ENV_FILE" ]]; then
    cp -p "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    ls -1t "${ENV_FILE}".bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f
    log_info "backed up ${ENV_FILE} (keeping last 5)"
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
STEP_TOTAL=5

# ───── Step 1: sync source to ICESLAB_REF ─────
# Honors ICESLAB_REF (branch like `main`, or pinned tag like v0.1.4); defaults
# to the current branch. See git_sync_to_ref in _lib.sh for why this replaced a
# bare `git pull` (the tag-pinned detached-HEAD silent-no-op trap).
step 1 "sync source (ICESLAB_REF=${ICESLAB_REF:-auto: branch or main})"
git_sync_to_ref
if [[ "$SHA_BEFORE" == "$SHA_AFTER" ]]; then
    log_info "  ${SYNC_TARGET}: no new commits, re-deploying ${SHA_AFTER}"
else
    log_info "  ${SYNC_TARGET}: ${SHA_BEFORE} -> ${SHA_AFTER}"
fi
step_done

# ───── Step 2: rebuild (BEFORE migrate) ─────
# Build first. The migrate one-shot below runs the same iceslab-backend:latest
# image, so the migration files baked into it must already be the new ones.
# If migrate ran first against the previous image, a deploy that adds a
# migration would skip it and the fresh backend would boot on an un-migrated
# DB. So: build, then migrate.
if [[ $NO_CACHE -eq 1 ]]; then
    step 2 "rebuild backend + frontend (--no-cache)"
    # retry: the build pulls base images + npm/prisma engine over the network,
    # which flakes with transient ECONNRESET/ETIMEDOUT (caught live). 3 attempts
    # turn a blip into a slower deploy instead of a failed one.
    retry 3 "${DC[@]}" build --no-cache backend frontend
else
    step 2 "rebuild backend + frontend (cached)"
    retry 3 "${DC[@]}" build backend frontend
fi
step_done

# ───── Step 3: prisma migrate deploy ─────
step 3 "prisma migrate deploy"
# Bring postgres up first: some compose backends (notably podman's docker shim)
# don't reliably attach `run --rm` containers to the project network, which
# makes postgres:5432 unresolvable. Starting postgres first and using
# `up --abort-on-container-exit` for the one-shot migrate sidesteps that.
# Runs the image built in step 2, so new migrations are present.
"${DC[@]}" up -d postgres
# Wait for postgres to accept connections before the one-shot migrate; a cold
# start otherwise races and migrate fails with a confusing "connection refused".
for _i in $(seq 1 30); do
    if "${DC[@]}" exec -T postgres pg_isready -q 2>/dev/null; then break; fi
    if [[ $_i -eq 30 ]]; then log_warn "postgres not ready after 30s; running migrate anyway"; fi
    sleep 1
done
# migrate runs ONCE (no retry): success = migrations applied; a non-zero here is
# a real migration/SQL error (shown inline above), not a transient blip.
"${DC[@]}" up --abort-on-container-exit --exit-code-from migrate migrate
"${DC[@]}" rm -fsv migrate >/dev/null 2>&1 || true
step_done

# ───── Step 4: restart all services ─────
step 4 "restart all services"
"${DC[@]}" up -d --build
step_done

# ───── Step 5: status + backend tail ─────
step 5 "status + backend tail"
"${DC[@]}" ps
echo
log_info "backend tail (last 30 lines):"
"${DC[@]}" logs --tail=30 backend || true
step_done

# ───── Optional cleanup ─────
if [[ $CLEANUP_AFTER -eq 1 ]]; then
    echo
    log_info "running cleanup"
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/cleanup.sh"
fi

echo
log_ok "deploy complete in $(elapsed_total), now serving ${SHA_AFTER}"
