#!/usr/bin/env bash
# cleanup.sh: reclaim disk from old Docker images / build cache.
#
# Every `--build` leaves the previous image as an untagged dangling layer
# kept "for rollback". Over ~5-10 deploys that fills `/var/lib/docker` with
# multi-GB of waste.
#
# Removes:
#   - Dangling / unused images (not referenced by a running container or
#     a current tag)
#   - Build cache layers
#   - Stopped containers (the migrate one-shot already uses `--rm`; this
#     clears panel-backend/frontend left stopped after a crash)
#
# Does NOT touch:
#   - Named volumes (postgres_prod_data + redis_prod_data, the live DB).
#     `docker volume prune` is a foot-cannon, never run it blind on this
#     host.
#   - Networks (recreating them is cheap)
#
# Usage:    ./scripts/cleanup.sh
#           ./scripts/cleanup.sh --dry      # preview only, no deletion
#
# Schedule weekly via cron:
#   0 4 * * 0  cd /opt/iceslab && ./scripts/cleanup.sh >> /var/log/iceslab-cleanup.log 2>&1

set -euo pipefail

LIB_PREFIX="cleanup"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Args ─────
DRY=0
for arg in "$@"; do
    case "$arg" in
        --dry|--dry-run|-n) DRY=1 ;;
        -h|--help)
            sed -n '2,25p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log_err "unknown arg: $arg"
            exit 2
            ;;
    esac
done

if [[ $DRY -eq 1 ]]; then
    log_info "DRY-RUN mode, nothing will be deleted"
fi

run() {
    if [[ $DRY -eq 1 ]]; then
        printf '  %b[dry]%b would run: %s\n' "$C_DIM" "$C_RST" "$*"
    else
        "$@"
    fi
}

STEP_TOTAL=3

# ───── Disk before ─────
log_info "disk usage before:"
df -h /var/lib/docker 2>/dev/null || df -h /

# ───── Step 1: images ─────
step 1 "prune dangling + unused images"
run docker image prune --all --force
step_done

# ───── Step 2: build cache ─────
step 2 "prune build cache"
run docker builder prune --all --force
step_done

# ───── Step 3: stopped containers ─────
step 3 "prune stopped containers"
run docker container prune --force
step_done

echo
log_info "disk usage after:"
df -h /var/lib/docker 2>/dev/null || df -h /

echo
log_ok "cleanup complete in $(elapsed_total)"
log_info "volumes (postgres + redis data) left untouched:"
docker volume ls --filter 'name=iceslab'
