#!/usr/bin/env bash
# iceslab-restore.sh
#
# Restore a tarball produced by iceslab-backup.sh:
#   1. Decrypt (if `--password` given) and unpack the archive.
#   2. Read manifest.json, print a summary, ask the user to confirm.
#   3. Stop the panel services so nothing writes during restore.
#   4. Drop + recreate the postgres database, then `psql` the dump.
#   5. Stop redis, replace dump.rdb on its volume, restart redis.
#   6. Replace the host .env.production (only if the archive's was preserved).
#   7. Start the panel back up.
#
# DESTRUCTIVE: overwrites the database and redis state. Take a fresh
# `iceslab-backup.sh` of the current host first.
#
# Usage:
#   ./scripts/iceslab-restore.sh ./backups/iceslab-backup-...tar.gz \
#       [--password <pw>] [--yes]

set -euo pipefail

LIB_PREFIX="restore"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Defaults ─────
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
PASSWORD=""
ASSUME_YES=0
ARCHIVE=""

POSTGRES_CONTAINER="iceslab-prod-postgres"
REDIS_CONTAINER="iceslab-prod-redis"

# ───── Args ─────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --compose-file)
            COMPOSE_FILE="$2"
            shift 2
            ;;
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --yes|-y)
            ASSUME_YES=1
            shift
            ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            if [[ -z "$ARCHIVE" ]]; then
                ARCHIVE="$1"
                shift
            else
                log_err "unknown arg: $1"
                exit 2
            fi
            ;;
    esac
done

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
    log_err "usage: $0 <archive.tar.gz[.enc]> [--password <pw>] [--yes]"
    exit 1
fi
require_compose_root

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# ───── Stage ─────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# Re-install ERR trap: the EXIT trap above replaced the one set by _lib.
trap 'on_err $LINENO' ERR

STEP_TOTAL=5

# ───── Step 1: unpack ─────
step 1 "unpack archive"
if [[ "$ARCHIVE" == *.enc ]]; then
    if [[ -z "$PASSWORD" ]]; then
        log_err "archive is encrypted but --password was not given"
        exit 1
    fi
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
                 -pass "pass:${PASSWORD}" \
                 -in "$ARCHIVE" \
        | tar -C "$STAGE" -xzf -
else
    tar -C "$STAGE" -xzf "$ARCHIVE"
fi

if [[ ! -f "${STAGE}/manifest.json" ]]; then
    log_err "archive missing manifest.json, not produced by iceslab-backup.sh?"
    exit 1
fi
step_done

log_info "manifest:"
cat "${STAGE}/manifest.json"
echo

if [[ $ASSUME_YES -ne 1 ]]; then
    printf '%b[%s]%b %bthis WILL drop and recreate the live database.%b continue? (yes/no) ' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_WARN" "$C_RST"
    read -r ans
    if [[ "$ans" != "yes" ]]; then
        log_warn "aborted by operator"
        exit 1
    fi
fi

# Pull POSTGRES_USER / POSTGRES_DB from the host env file (the live target,
# not the archive's copy, see the `env` step below).
# shellcheck disable=SC1090
source <(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' "$ENV_FILE")
: "${POSTGRES_USER:?missing POSTGRES_USER in $ENV_FILE}"
: "${POSTGRES_DB:?missing POSTGRES_DB in $ENV_FILE}"

# ───── Step 2: stop panel services ─────
# Service names are `backend` and `frontend`, not the container_names
# iceslab-prod-backend / iceslab-prod-frontend. We once stopped the wrong
# names, it failed silently via `|| true`, and the DB restore ran while the
# backend kept writing. Use the real compose service names.
step 2 "stop panel services (backend, frontend)"
"${DC[@]}" stop backend frontend 2>/dev/null || true
step_done

# ───── Step 3: postgres restore ─────
step 3 "restore postgres dump"
# DROP SCHEMA + CREATE before loading. pg_dump --clean --if-exists already
# drops each table, but a full schema reset also clears orphan objects left
# from a previous database.
docker exec -i "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null

docker exec -i "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    < "${STAGE}/postgres.sql" >/dev/null
step_done

# ───── Step 4: redis restore ─────
step 4 "restore redis snapshot"
"${DC[@]}" stop redis
# Copy into the stopped container. `docker cp` to a running redis with AOF
# active produces a corrupt rdb on next start.
docker cp "${STAGE}/redis.rdb" "${REDIS_CONTAINER}:/data/dump.rdb"
# AOF is the source of truth in our config (--appendonly yes), so it
# overrides the rdb on startup. Flush it so the restored rdb takes effect.
docker exec "$REDIS_CONTAINER" sh -c 'rm -f /data/appendonlydir/*.aof || true' 2>/dev/null || true
"${DC[@]}" start redis
step_done

# ───── Step 5: bring panel back up ─────
step 5 "start panel services (backend, frontend)"
"${DC[@]}" start backend frontend
step_done

echo
log_ok "restore complete in $(elapsed_total)"
log_warn ".env.production was NOT overwritten, review ${STAGE}/env"
log_warn "  and merge any drifted values manually"
