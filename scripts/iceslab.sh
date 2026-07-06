#!/usr/bin/env bash
# iceslab.sh: the single entry point for operating an Iceslab panel host.
#
#   bash scripts/iceslab.sh              # interactive menu: explains each action, runs your pick
#   bash scripts/iceslab.sh deploy       # run an action directly (flags pass through)
#   bash scripts/iceslab.sh deploy --cache
#   bash scripts/iceslab.sh help         # just print what each action does + when
#
# One menu instead of remembering ten script names. Each action routes to the
# matching, individually-tested script in scripts/; this file only explains and
# dispatches, so the deploy/backup logic stays in one place and stays stable.

set -euo pipefail
LIB_PREFIX="iceslab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/_lib.sh
source "$SCRIPT_DIR/ops/_lib.sh"

# Parallel arrays; index order = menu order. KEYS also accepted as direct args.
KEYS=(deploy deploy-backend deploy-frontend logs cleanup backup restore)
RUN=(deploy.sh deploy-backend.sh deploy-frontend.sh logs.sh cleanup.sh iceslab-backup.sh iceslab-restore.sh)
WHAT=(
    "Full re-deploy: rebuild backend+frontend, migrate the DB, restart."
    "Backend only: rebuild + migrate + restart (frontend untouched)."
    "Frontend only: rebuild + restart the SPA (no migration)."
    "Tail service logs (backend/frontend/postgres/redis/caddy); -f follows."
    "Prune dangling Docker images + build cache left by past deploys."
    "Back up Postgres + Redis + .env.production into one tarball."
    "Restore a backup tarball. DESTRUCTIVE: overwrites the DB + redis."
)
WHEN=(
    "after any change, or to pull the latest release."
    "you changed only the backend, or added a Prisma migration."
    "you changed only the panel UI."
    "debugging a running service."
    "the panel-host disk fills up after several deploys."
    "before a risky op or restore, or on a schedule."
    "recovery, or moving the panel to a new host."
)

print_guide() {
    printf '%bIceslab ops%b - choose an action; it explains each one and runs it.\n' "$C_INFO" "$C_RST"
    printf '%bruns from the panel root; each action also takes -h for its own flags.%b\n' "$C_DIM" "$C_RST"
    local i
    for i in "${!KEYS[@]}"; do
        printf '  %b%2d)%b %b%-16s%b %s\n' \
            "$C_OK" "$((i + 1))" "$C_RST" "$C_INFO" "${KEYS[$i]}" "$C_RST" "${WHAT[$i]}"
        printf '      %bwhen:%b %s\n' "$C_DIM" "$C_RST" "${WHEN[$i]}"
    done
    printf '  %b q)%b quit\n' "$C_OK" "$C_RST"
    printf '\n%bfresh host?%b run install-iceslab.sh (panel) or install-iceslab-node.sh (node) instead.\n' \
        "$C_DIM" "$C_RST"
}

run_action() {
    local key="$1"
    shift || true
    local i
    for i in "${!KEYS[@]}"; do
        if [[ "${KEYS[$i]}" == "$key" ]]; then
            log_info "running: ops/${RUN[$i]} $*"
            exec "$SCRIPT_DIR/ops/${RUN[$i]}" "$@"
        fi
    done
    log_err "unknown action: ${key}"
    log_err "valid actions: ${KEYS[*]}"
    exit 2
}

# ── Direct mode: iceslab.sh <action> [args...] ──
if [[ $# -gt 0 ]]; then
    case "$1" in
        -h | --help | help) print_guide; exit 0 ;;
        *) run_action "$@" ;;
    esac
fi

# ── Interactive menu (needs a terminal) ──
if [[ ! -t 0 ]]; then
    print_guide
    log_err "no terminal for the menu; pass an action directly, e.g. iceslab.sh deploy"
    exit 2
fi

print_guide
printf '\n'
read -rp "$(printf '%b[iceslab]%b choose [1-%d / q]: ' "$C_INFO" "$C_RST" "${#KEYS[@]}")" choice
case "$choice" in
    q | Q | '') log_info "nothing to do"; exit 0 ;;
esac
if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#KEYS[@]} )); then
    run_action "${KEYS[$((choice - 1))]}"
else
    log_err "invalid choice: ${choice}"
    exit 2
fi
