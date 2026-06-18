#!/usr/bin/env bash
# deploy-backend.sh: backend-only re-deploy.
#
# Pulls latest, applies pending migrations, rebuilds + restarts backend.
# Frontend stays untouched. --no-cache is on by default: costs ~20s extra
# rebuild so what you see is what shipped. Pass --cache to use the Docker
# layer cache when you trust the diff.
#
# Usage:
#   ./scripts/deploy-backend.sh           # default --no-cache
#   ./scripts/deploy-backend.sh --cache   # use Docker cache (faster)

set -euo pipefail

LIB_PREFIX="deploy-be"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Args ─────
NO_CACHE=1
for arg in "$@"; do
    case "$arg" in
        --no-cache|--fresh) NO_CACHE=1 ;;
        --cache)            NO_CACHE=0 ;;
        -h|--help)
            sed -n '2,11p' "$0" | sed 's/^# \?//'
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

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
STEP_TOTAL=4

# ───── Step 1: sync source to ICESLAB_REF ─────
# Honors ICESLAB_REF (branch or pinned tag), defaults to the current branch.
# See git_sync_to_ref in _lib.sh; it avoids the bare `git pull` detached-HEAD trap.
step 1 "sync source (ICESLAB_REF=${ICESLAB_REF:-current branch})"
git_sync_to_ref
if [[ "$SHA_BEFORE" == "$SHA_AFTER" ]]; then
    log_info "  ${SYNC_TARGET}: no new commits, re-deploying ${SHA_AFTER}"
else
    log_info "  ${SYNC_TARGET}: ${SHA_BEFORE} -> ${SHA_AFTER}"
fi
step_done

# ───── Step 2: rebuild backend (BEFORE migrate) ─────
# Build first: the migrate one-shot below runs the same iceslab-backend:latest
# image, so its migrations must be the new ones. Migrate-first (against the old
# image) silently skips a freshly-added migration. See deploy.sh for the full
# rationale.
if [[ $NO_CACHE -eq 1 ]]; then
    step 2 "rebuild backend (--no-cache)"
    "${DC[@]}" build --no-cache backend
else
    step 2 "rebuild backend (cached)"
    "${DC[@]}" build backend
fi
step_done

# ───── Step 3: prisma migrate deploy ─────
step 3 "prisma migrate deploy"
# Same trick as deploy.sh: use `up --abort-on-container-exit` instead of
# `run --rm` so the migrate container reliably joins the project network
# (podman compose backends have a known regression with `run`). Runs the image
# built in step 2 so new migrations are present.
"${DC[@]}" up -d postgres
"${DC[@]}" up --abort-on-container-exit --exit-code-from migrate migrate
"${DC[@]}" rm -fsv migrate >/dev/null 2>&1 || true
step_done

# ───── Step 4: restart backend + status ─────
step 4 "restart backend + status"
"${DC[@]}" up -d --build backend
echo
"${DC[@]}" ps backend
echo
log_info "backend tail (last 40 lines):"
"${DC[@]}" logs --tail=40 backend || true
step_done

echo
log_ok "backend deploy complete in $(elapsed_total), now serving ${SHA_AFTER}"
