#!/usr/bin/env bash
# deploy-frontend.sh: fast path for SPA-only changes.
#
# Skips Prisma migrate + backend rebuild. Use when you only edited files
# under apps/panel-frontend/. --no-cache is ON by default: the Vite bundle
# is content-hashed, but the COPY layer occasionally gets a Docker cache hit
# that lands a stale dist/ in the image. Roughly 30s slower, but what you see
# is what shipped.
#
# Usage:
#   ./scripts/deploy-frontend.sh           # default --no-cache
#   ./scripts/deploy-frontend.sh --cache   # use Docker layer cache (faster,
#                                            occasionally stale; only when you
#                                            trust the diff)

set -euo pipefail

LIB_PREFIX="deploy-fe"
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
            sed -n '2,15p' "$0" | sed 's/^# \?//'
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
STEP_TOTAL=3

# ───── Step 1: sync source to ICESLAB_REF ─────
# Honors ICESLAB_REF (branch or pinned tag); defaults to the current branch.
# git_sync_to_ref in _lib.sh avoids the detached-HEAD trap that bare `git pull` hits.
step 1 "sync source (ICESLAB_REF=${ICESLAB_REF:-auto: branch or main})"
git_sync_to_ref
if [[ "$SHA_BEFORE" == "$SHA_AFTER" ]]; then
    log_info "  ${SYNC_TARGET}: no new commits, re-deploying ${SHA_AFTER}"
else
    log_info "  ${SYNC_TARGET}: ${SHA_BEFORE} -> ${SHA_AFTER}"
fi
step_done

# ───── Step 2: rebuild frontend ─────
if [[ $NO_CACHE -eq 1 ]]; then
    step 2 "rebuild frontend (--no-cache)"
    retry 3 "${DC[@]}" build --no-cache frontend
    "${DC[@]}" up -d frontend
else
    step 2 "rebuild + restart frontend (cached)"
    retry 3 "${DC[@]}" up -d --build frontend
fi
step_done

# ───── Step 3: status ─────
step 3 "status"
"${DC[@]}" ps frontend
step_done

echo
log_ok "frontend deploy complete in $(elapsed_total), now serving ${SHA_AFTER}"
